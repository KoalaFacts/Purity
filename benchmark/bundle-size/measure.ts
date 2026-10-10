import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { parseSync } from 'oxc-parser';
import { purity } from '../../packages/vite-plugin/dist/index.js';

interface Sizes {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}
interface Measurement extends Sizes {
  profile: string;
  functionConstructorCalls: number;
  chunks: Array<Sizes & { file: string }>;
}

const root = resolve(import.meta.dirname, '../..');
const scenarios = [
  { name: 'counter', entry: 'counter.ts', templates: ['counter.ts'] },
  { name: 'controls', entry: 'controls.ts', templates: ['controls-view.ts'] },
  { name: 'form', entry: 'form.ts', templates: ['form.ts'] },
  { name: 'hydration', entry: 'hydration.ts', templates: ['controls-view.ts'] },
];
const outputDir = join(root, 'benchmark/dist/bundle-size');
const measureOnly = process.argv.includes('--measure-only');
const verify = process.argv.includes('--verify');
assert(
  process.argv.slice(2).every((arg) => arg === '--measure-only' || arg === '--verify'),
  'Unknown argument',
);
const payloads = new Map<string, string>();
assert(
  !/conditions(?:=|\s+)[^ ]*development/.test(
    [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' '),
  ),
  'Run without the development export condition; measure built packages',
);

function sizes(source: string): Sizes {
  const bytes = Buffer.from(source);
  return {
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

function functionConstructorCalls(file: string, code: string): number {
  const result = parseSync(file, code, { sourceType: 'module' });
  assert.equal(result.errors.length, 0, 'Cannot inspect production JavaScript');
  const pending: unknown[] = [result.program];
  let calls = 0;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    const node = value as Record<string, unknown>;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee as Record<string, unknown>;
      if (callee.type === 'Identifier' && callee.name === 'Function') calls++;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  return calls;
}

async function measure(scenario: (typeof scenarios)[number], aot: boolean): Promise<Measurement> {
  const templates = new Set(scenario.templates.map((file) => join(import.meta.dirname, file)));
  const seen = new Set<string>();
  const inspectTransform: Plugin = {
    name: 'purity-bundle-size-transform-proof',
    enforce: 'post',
    transform(code, id) {
      const file = resolve(id.split('?')[0]);
      if (!templates.has(file)) return;
      seen.add(file);
      assert.equal(code.includes('__purity_tpl_'), aot, 'Unexpected fixture compilation path');
      assert.equal(/html`/.test(code), !aot, 'Unexpected runtime template path');
    },
  };
  const result = await build({
    root,
    configFile: false,
    mode: 'production',
    logLevel: 'error',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [...(aot ? [purity()] : []), inspectTransform],
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: {
        input: join(import.meta.dirname, scenario.entry),
        output: { entryFileNames: 'entry.js' },
      },
    },
  });
  assert.equal(
    seen.size,
    templates.size,
    'Fixture templates did not pass through the build pipeline',
  );
  assert(!Array.isArray(result) && 'output' in result, 'Expected one production output');
  const chunks = result.output.filter((item) => item.type === 'chunk');
  assert(
    chunks.some((chunk) => chunk.isEntry),
    'Missing JavaScript entry',
  );
  assert.equal(chunks.length, result.output.length, 'Unexpected non-JavaScript payload');
  const files = new Set(chunks.map((chunk) => chunk.fileName));
  for (const chunk of chunks) {
    assert(chunk.code.length > 0, 'Empty output');
    assert.equal(chunk.dynamicImports.length, 0, 'Fixture must not hide lazy payload');
    assert(
      chunk.imports.every((name) => files.has(name)),
      'Unbundled external dependency',
    );
  }
  const renderedModules = chunks.flatMap((chunk) =>
    Object.entries(chunk.modules)
      .filter(([, info]) => info.renderedLength > 0)
      .map(([id]) => id.replaceAll('\\', '/')),
  );
  assert(
    renderedModules.some((id) => id.includes('/packages/core/dist/')),
    'Missing built core',
  );
  assert(
    !renderedModules.some((id) => id.includes('/packages/core/src/')),
    'Source export measured',
  );
  const profile = `${scenario.name}-${aot ? 'aot' : 'runtime'}`;
  for (const chunk of chunks) payloads.set(`/${profile}/${chunk.fileName}`, chunk.code);
  const measured = chunks.map((chunk) => ({ file: chunk.fileName, ...sizes(chunk.code) }));
  const total = measured.reduce(
    (sum, item) => ({
      rawBytes: sum.rawBytes + item.rawBytes,
      gzipBytes: sum.gzipBytes + item.gzipBytes,
      brotliBytes: sum.brotliBytes + item.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
  return {
    profile,
    ...total,
    chunks: measured,
    functionConstructorCalls: chunks.reduce(
      (sum, chunk) => sum + functionConstructorCalls(chunk.fileName, chunk.code),
      0,
    ),
  };
}

// Published entry points whose full size is budgeted. Each is measured as
// everything it exports (`export * from …`), minified, from the built dist.
// Other Purity packages and Node built-ins are external, so each figure is
// that package's own code. The Vite plugin and CLI are build-time Node tools
// and are not budgeted.
const packageEntries = [
  { name: 'core', specifier: '@purityjs/core', dist: 'packages/core/dist/' },
  { name: 'core-compiler', specifier: '@purityjs/core/compiler', dist: 'packages/core/dist/' },
  { name: 'ssr', specifier: '@purityjs/ssr', dist: 'packages/ssr/dist/' },
];

interface PackageMeasurement extends Sizes {
  entry: string;
}

async function measurePackage(entry: (typeof packageEntries)[number]): Promise<PackageMeasurement> {
  const virtualId = '\0purity-package-entry';
  const result = await build({
    root,
    configFile: false,
    mode: 'production',
    logLevel: 'error',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [
      {
        name: 'purity-package-entry',
        resolveId: (id) => (id === 'purity-package-entry' ? virtualId : undefined),
        load: (id) => (id === virtualId ? `export * from '${entry.specifier}';` : undefined),
      },
    ],
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: {
        input: 'purity-package-entry',
        // App builds drop entry exports by default; keep every export of the entry.
        preserveEntrySignatures: 'strict',
        external: (id) =>
          id.startsWith('node:') ||
          (id.startsWith('@purityjs/') &&
            !id.startsWith(entry.specifier.split('/').slice(0, 2).join('/'))),
        output: { entryFileNames: 'entry.js', codeSplitting: false },
      },
    },
  });
  assert(!Array.isArray(result) && 'output' in result, 'Expected one production output');
  const chunks = result.output.filter((item) => item.type === 'chunk');
  assert.equal(chunks.length, 1, 'Package entry must measure as one payload');
  const rendered = Object.keys(chunks[0].modules).map((id) => id.replaceAll('\\', '/'));
  assert(
    rendered.some((id) => id.includes(`/${entry.dist}`)),
    `Missing built ${entry.specifier}`,
  );
  assert(!rendered.some((id) => id.includes('/src/')), 'Source export measured');
  return { entry: entry.name, ...sizes(chunks[0].code) };
}

async function packageVersion(path: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
  assert.equal(typeof pkg.version, 'string');
  return pkg.version;
}

const budgets = JSON.parse(await readFile(join(import.meta.dirname, 'budgets.json'), 'utf8'));
const packageMeasurements: PackageMeasurement[] = [];
for (const entry of packageEntries) packageMeasurements.push(await measurePackage(entry));
const measurements: Measurement[] = [];
for (const scenario of scenarios) {
  measurements.push(await measure(scenario, false), await measure(scenario, true));
}
let verification: {
  status: string;
  engines: Record<string, string>;
  profiles?: string[];
  ssrHtmlSha256?: string;
} = { status: 'not-run', engines: {} };
if (verify) {
  try {
    verification = await (
      await import('./verify.ts')
    ).verifyProfiles(
      root,
      outputDir,
      measurements.map((item) => item.profile),
      payloads,
    );
  } catch (error) {
    // Preserve size evidence on browser failure. Diagnostics belong in the
    // job log, keeping local paths out of the portable JSON report.
    console.error(error);
    verification = { status: 'failed', engines: {} };
  }
}
// Size budgets apply to the published packages. Fixture apps are size-reported
// only; their Function-constructor count stays enforced because AOT output
// must keep working under a CSP without unsafe-eval.
const violations: string[] = [];
for (const item of packageMeasurements) {
  for (const metric of ['gzipBytes', 'brotliBytes'] as const) {
    const budget = budgets.packages?.[item.entry]?.[metric];
    assert(Number.isSafeInteger(budget) && budget >= 1, 'Invalid package size budget');
    if (item[metric] > budget)
      violations.push(`${item.entry}: ${metric} ${item[metric]} > ${budget}`);
  }
}
for (const item of measurements) {
  const budget = budgets.fixtures?.[item.profile]?.functionConstructorCalls;
  assert(Number.isSafeInteger(budget) && budget >= 0, 'Invalid fixture budget');
  if (item.functionConstructorCalls > budget)
    violations.push(
      `${item.profile}: functionConstructorCalls ${item.functionConstructorCalls} > ${budget}`,
    );
}
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const report = {
  schemaVersion: 3,
  revision: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0,
  node: process.versions.node,
  zlib: process.versions.zlib,
  brotli: process.versions.brotli,
  versions: {
    core: await packageVersion('packages/core'),
    plugin: await packageVersion('packages/vite-plugin'),
    ssr: await packageVersion('packages/ssr'),
    vite: await packageVersion('node_modules/vite'),
    parser: await packageVersion('node_modules/oxc-parser'),
  },
  fixtureHashes: Object.fromEntries(
    await Promise.all(
      [
        ...new Set([
          ...scenarios.flatMap((scenario) => [scenario.entry, ...scenario.templates]),
          'controls-server.ts',
        ]),
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(
            (await readFile(join(import.meta.dirname, file), 'utf8')).replaceAll('\r\n', '\n'),
          )
          .digest('hex'),
      ]),
    ),
  ),
  artifactsSha256: {
    core: createHash('sha256')
      .update(await readFile(join(root, 'packages/core/dist/index.js')))
      .digest('hex'),
    coreCompiler: createHash('sha256')
      .update(await readFile(join(root, 'packages/core/dist/compiler/index.js')))
      .digest('hex'),
    ssr: createHash('sha256')
      .update(await readFile(join(root, 'packages/ssr/dist/index.js')))
      .digest('hex'),
    plugin: createHash('sha256')
      .update(await readFile(join(root, 'packages/vite-plugin/dist/index.js')))
      .digest('hex'),
  },
  verification,
  settings: {
    target: 'es2022',
    minify: true,
    gzipLevel: 9,
    brotliQuality: 11,
    perFileCompression: true,
  },
  scope:
    'Packages: every export of each published entry, minified, from built dist; other Purity packages and Node built-ins external. Fixtures: complete fixture JavaScript payload, reported only.',
  packages: packageMeasurements,
  measurements,
  budgets,
  violations,
  budgetEnforced: !measureOnly,
};
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const summary = [
  '## Purity package and fixture bundle sizes',
  '',
  `Revision: ${report.revision}; dirty: ${report.dirty}; Node: ${report.node}`,
  `Core: ${report.versions.core}; SSR: ${report.versions.ssr}; plugin: ${report.versions.plugin}; Vite: ${report.versions.vite}; parser: ${report.versions.parser}`,
  '',
  '| Package entry | Raw bytes | gzip bytes | Brotli bytes | gzip budget | Brotli budget |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...packageMeasurements.map(
    (item) =>
      `| ${item.entry} | ${item.rawBytes} | ${item.gzipBytes} | ${item.brotliBytes} | ${budgets.packages[item.entry].gzipBytes} | ${budgets.packages[item.entry].brotliBytes} |`,
  ),
  '',
  'Fixture apps (size reported only):',
  '',
  '| Profile | Raw bytes | gzip bytes | Brotli bytes | Function constructor calls |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...measurements.map(
    (item) =>
      `| ${item.profile} | ${item.rawBytes} | ${item.gzipBytes} | ${item.brotliBytes} | ${item.functionConstructorCalls} |`,
  ),
  '',
  report.scope,
  'Compression is per emitted JavaScript file. Fixture results are examples, not a universal framework size.',
  `Browser verification: ${verification.status}; engines: ${JSON.stringify(verification.engines)}.`,
  `Budget checks: ${measureOnly ? 'not enforced' : violations.length ? 'failed' : 'passed'}.`,
  ...violations,
  '',
].join('\n');
console.log(summary);
await writeFile(join(outputDir, 'report.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if ((!measureOnly && violations.length) || verification.status === 'failed') process.exitCode = 1;
