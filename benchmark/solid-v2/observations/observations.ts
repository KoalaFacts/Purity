import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const option = (name) => {
  const position = process.argv.indexOf(name);
  const value = position === -1 ? undefined : process.argv[position + 1];
  if (position !== -1 && (!value || value.startsWith('--')))
    throw new Error(`Missing value: ${name}`);
  return value;
};
const sourceRoot = option('--purity-root');
const packagesRoot = option('--deps-root');
const output = option('--output');
if (!sourceRoot || !packagesRoot || !output) {
  throw new Error(
    'Usage: node observations.ts --purity-root <checkout> --deps-root <download-dir>/node_modules --output <new-trace.json>',
  );
}
const purityRoot = resolve(sourceRoot);
const dependencyRoot = resolve(packagesRoot);
const outputPath = resolve(output);
const provenancePath = resolve(
  option('--provenance') ?? resolve(dependencyRoot, '..', 'package-provenance.json'),
);
const inputsPath = resolve(option('--inputs') ?? resolve(directory, 'inputs.json'));
const inputs = JSON.parse(await readFile(inputsPath, 'utf8'));
if (process.version !== inputs.runtime.node) throw new Error(`Use Node ${inputs.runtime.node}`);
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const actualSourceHashes = {};
for (const [relativePath, expected] of Object.entries(inputs.purity.source_sha256)) {
  const actual = await sha256(resolve(purityRoot, relativePath));
  if (actual !== expected) throw new Error(`Frozen Purity input hash mismatch: ${relativePath}`);
  actualSourceHashes[relativePath] = actual;
}
const actualSolidEntryHashes = {};
for (const [relativePath, expected] of Object.entries(inputs.solid.entry_sha256)) {
  const actual = await sha256(resolve(dependencyRoot, relativePath));
  if (actual !== expected)
    throw new Error(`Solid client/engine entry hash mismatch: ${relativePath}`);
  actualSolidEntryHashes[relativePath] = actual;
}
for (const expected of inputs.solid.packages) {
  const installed = JSON.parse(
    await readFile(resolve(dependencyRoot, expected.name, 'package.json'), 'utf8'),
  );
  const record = provenance.find((entry) => entry.name === expected.name);
  if (
    installed.name !== expected.name ||
    installed.version !== expected.version ||
    record?.version !== expected.version ||
    record?.integrity !== expected.integrity ||
    record?.gitHead !== inputs.solid.git_commit
  ) {
    throw new Error(`Exact Solid package input mismatch: ${expected.name}`);
  }
}
const purityEntry = `${purityRoot}/packages/core/src/signals.ts`;
const purityHooksEntry = `${purityRoot}/packages/core/src/component.ts`;
// This direct file import deliberately bypasses solid-js's Node/server export.
const solidEntry = pathToFileURL(resolve(dependencyRoot, 'solid-js/dist/solid.js'));
// This pinned signals export map has no import/require distinction. Resolve
// from the client file so CLI and NODE_OPTIONS conditions cannot select dev/test.
const resolvedSignalsEntry = createRequire(solidEntry).resolve('@solidjs/signals');
const relativeSignalsEntry = relative(dependencyRoot, resolvedSignalsEntry).replaceAll('\\', '/');
if (resolvedSignalsEntry !== resolve(dependencyRoot, '@solidjs/signals/dist/prod/index.js')) {
  throw new Error(
    `Expected @solidjs/signals production entry; resolved ${relativeSignalsEntry}. Check command-line conditions and NODE_OPTIONS.`,
  );
}
const purity = await import(pathToFileURL(purityEntry).href);
const { onDispose } = await import(pathToFileURL(purityHooksEntry).href);
const solid = await import(solidEntry.href);
const tick = () => new Promise((done) => queueMicrotask(done));

async function purityReadAfterWrite() {
  const value = purity.state(0);
  const doubled = purity.compute(() => value() * 2);
  const trace = [{ point: 'before-write', value: value(), doubled: doubled() }];
  value(1);
  trace.push({ point: 'same-stack-after-write', value: value(), doubled: doubled() });
  await tick();
  trace.push({ point: 'after-next-microtask', value: value(), doubled: doubled() });
  return trace;
}

async function solidReadAfterWrite() {
  const scope = solid.createRoot((dispose) => {
    const [value, setValue] = solid.createSignal(0);
    const doubled = solid.createMemo(() => value() * 2);
    return { value, setValue, doubled, dispose };
  });
  const trace = [{ point: 'before-write', value: scope.value(), doubled: scope.doubled() }];
  scope.setValue(1);
  trace.push({ point: 'same-stack-after-write', value: scope.value(), doubled: scope.doubled() });
  await tick();
  trace.push({ point: 'after-next-microtask', value: scope.value(), doubled: scope.doubled() });
  scope.dispose();
  return trace;
}

async function purityEffectTiming() {
  const trace = [];
  const value = purity.state(0);
  trace.push('before-effect-create');
  const stop = purity.watch(() => {
    trace.push(['effect-apply', value()]);
  });
  trace.push('after-effect-create');
  await tick();
  trace.push('after-initial-microtask');
  value(1);
  trace.push('after-write');
  await tick();
  trace.push('after-update-microtask');
  stop();
  return trace;
}

async function solidEffectTiming() {
  const trace = [];
  trace.push('before-effect-create');
  const scope = solid.createRoot((dispose) => {
    const [value, setValue] = solid.createSignal(0);
    solid.createEffect(value, (current) => {
      trace.push(['effect-apply', current]);
    });
    return { setValue, dispose };
  });
  trace.push('after-effect-create');
  await tick();
  trace.push('after-initial-microtask');
  scope.setValue(1);
  trace.push('after-write');
  await tick();
  trace.push('after-update-microtask');
  scope.dispose();
  return trace;
}

async function purityExplicitDependencies() {
  const value = purity.state(0);
  const unrelated = purity.state(10);
  const calls = [];
  const trace = [];
  const stop = purity.watch(value, (current, previous) => {
    calls.push({ current, previous, unrelated: unrelated() });
  });
  const snapshot = (point) => trace.push({ point, calls: structuredClone(calls) });
  await tick();
  snapshot('after-initial-microtask');
  value(1);
  await tick();
  snapshot('after-declared-source-write');
  unrelated(20);
  await tick();
  snapshot('after-callback-only-source-write');
  value(2);
  await tick();
  snapshot('after-next-declared-source-write');
  stop();
  return trace;
}

async function solidExplicitDependencies() {
  const calls = [];
  const trace = [];
  const scope = solid.createRoot((dispose) => {
    const [value, setValue] = solid.createSignal(0);
    const [unrelated, setUnrelated] = solid.createSignal(10);
    solid.createEffect(value, (current, previous) => {
      calls.push({ current, previous: previous ?? null, unrelated: unrelated() });
    });
    return { setValue, setUnrelated, dispose };
  });
  const snapshot = (point) => trace.push({ point, calls: structuredClone(calls) });
  await tick();
  snapshot('after-initial-microtask');
  scope.setValue(1);
  await tick();
  snapshot('after-declared-source-write');
  scope.setUnrelated(20);
  await tick();
  snapshot('after-callback-only-source-write');
  scope.setValue(2);
  await tick();
  snapshot('after-next-declared-source-write');
  scope.dispose();
  return trace;
}

async function purityCleanupOrder() {
  const trace = [];
  // A source-free watch provides a public disposable owner in Purity.
  const stop = purity.watch(() => {
    onDispose(() => trace.push('parent:A'));
    onDispose(() => trace.push('parent:B'));
    purity.watch(() => {
      onDispose(() => trace.push('child:A'));
      onDispose(() => trace.push('child:B'));
    });
  });
  stop();
  await tick();
  return trace;
}

async function solidCleanupOrder() {
  const trace = [];
  const stop = solid.createRoot((dispose) => {
    solid.onCleanup(() => trace.push('parent:A'));
    solid.onCleanup(() => trace.push('parent:B'));
    solid.createRoot(() => {
      solid.onCleanup(() => trace.push('child:A'));
      solid.onCleanup(() => trace.push('child:B'));
    });
    return dispose;
  });
  stop();
  await tick();
  return trace;
}

const report = {
  purpose:
    'Four tiny behavior observations, not performance measurements or framework-wide conformance.',
  observed_at_utc: new Date().toISOString(),
  runtime: {
    node: process.version,
    execArgv: process.execArgv,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
    platform: process.platform,
    arch: process.arch,
    NODE_ENV: process.env.NODE_ENV ?? null,
    actual_browser: false,
    solid_branch:
      'Explicit solid-js/dist/solid.js client production entry, executed in Node; no Node SSR entry.',
    purity_source_execution: 'Node native TypeScript stripping; no source bundle/build command.',
    purity_entry: 'packages/core/src/signals.ts',
    purity_hooks_entry: 'packages/core/src/component.ts',
    solid_entry: 'node_modules/solid-js/dist/solid.js',
    solid_signals_entry: 'node_modules/@solidjs/signals/dist/prod/index.js',
    solid_signals_resolved_entry: relativeSignalsEntry,
    invocation:
      'NODE_OPTIONS= NODE_ENV=production <Node v24.21.0 executable> observations.ts --purity-root <checkout> --deps-root <download-dir>/node_modules --output <new-trace.json>',
  },
  provenance: {
    purity_commit: inputs.purity.commit,
    source_identity:
      'Recorded frozen checkout commit plus verified source hashes. Documentation edits are outside the observed source inputs; current whole-repository dirty status is not used.',
    packages: provenance,
    sha256: {
      purity_source: actualSourceHashes,
      solid_entries: actualSolidEntryHashes,
      inputs: await sha256(inputsPath),
      harness: await sha256(fileURLToPath(import.meta.url)),
    },
  },
  observations: [
    {
      name: 'sync_read_after_write',
      purity: await purityReadAfterWrite(),
      solid_v2: await solidReadAfterWrite(),
    },
    {
      name: 'effect_first_and_followup_timing',
      method_note:
        'Purity auto-track watch; Solid two-phase createEffect with the signal as tracked compute and a logging apply.',
      purity: await purityEffectTiming(),
      solid_v2: await solidEffectTiming(),
    },
    {
      name: 'explicit_apply_dependency_isolation',
      method_note:
        'Native first-run semantics retained: Purity explicit watch skips callback initially; Solid createEffect applies initially. Solid undefined initial previous is serialized as null.',
      purity: await purityExplicitDependencies(),
      solid_v2: await solidExplicitDependencies(),
    },
    {
      name: 'owner_cleanup_order',
      method_note:
        'Purity source-free nested watches with onDispose; Solid nested createRoot with onCleanup. This records these disposable-owner paths, not DOM component unmount order.',
      purity: await purityCleanupOrder(),
      solid_v2: await solidCleanupOrder(),
    },
  ],
  limits: [
    'No DOM, browser rendering, browser engines, hydration, async resource composition, or user-input state observed.',
    'No Purity repository install, lockfile change, source change, or unit/workspace test run.',
    'No Solid 1.9 comparison; exact rc.18 packages only.',
    'No PR294 code included; Purity is frozen main 58ff714.',
    'Purity source executes via Node native TypeScript stripping; no bundler or production Purity package build is claimed.',
  ],
};
// Explicit destination plus exclusive creation protects the archived baseline.
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
