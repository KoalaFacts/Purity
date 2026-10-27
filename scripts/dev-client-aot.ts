import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { parseSync } from 'oxc-parser';

function one(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length - 1, 1, `Expected exactly one source anchor: ${before.slice(0, 120)}`);
  return source.replace(before, after);
}
function save(file: string, value: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
  console.log(`Updated ${file}`);
}
const file = 'packages/vite-plugin/src/index.ts';
let source = readFileSync(file, 'utf8');
assert.equal(execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim(), '1100fd5a5d3836c005e6915b39d6d8fd3ec11a3a', 'Unexpected compiler base; do not overwrite another implementation');
source = one(source, 'export interface PurityPluginOptions {', 'export interface PurityPluginOptions {\n  /** Generate DOM-adoption walkers for SSR clients. Default false.\n   * Client-only builds call create factories directly and cannot hydrate server DOM. */\n  hydratable?: boolean;');
source = one(source, 'retained Purity runtime compilation in production client output. Default false.', 'retained Purity runtime compilation in production client output. Default true.');
source = one(source, '        options?.strictAot === true,\n      );', '        options?.strictAot !== false,\n        hydratable,\n      );');
source = one(source, 'compileTemplates(code, id, transformOpts?.ssr === true, true)', 'compileTemplates(code, id, transformOpts?.ssr === true, true, hydratable)');
source = source.replaceAll('options?.strictAot', 'strictAot');
source = one(source, 'export function purity(options?: PurityPluginOptions) {', 'export function purity(options?: PurityPluginOptions) {\n  const strictAot = options?.strictAot !== false;\n  const hydratable = options?.hydratable === true;');
source = one(source, '  strictAot: boolean;\n}', '  strictAot: boolean;\n  hydratable: boolean;\n}');
source = one(source, '  strictAot: boolean,\n): CompileResult {', '  strictAot: boolean,\n  hydratable: boolean,\n): CompileResult {');
source = one(source, '    strictAot,\n    id,', '    strictAot,\n    hydratable,\n    id,');
source = one(source, 'if (!ctx.ssr) hydrateBody = generateHydrateLinked(ast);', 'if (!ctx.ssr && ctx.hydratable) hydrateBody = generateHydrateLinked(ast);');
source = one(source,
  "    : `${p}_renderCompiled__(${tplVar}, ${tplVar}_hydrate, [${slots.join(', ')}])`;",
  ["    : ctx.hydratable", "      ? `${p}_renderCompiled__(${tplVar}, ${tplVar}_hydrate, [${slots.join(', ')}])`", "      : `${tplVar}([${slots.join(', ')}], ${p}_watch__)`;"].join('\n'));
source = one(source,
  "    : `import { renderCompiledTemplate as ${prefix}_renderCompiled__, flattenValue as ${prefix}_fl__, swapSlot as ${prefix}_sw__ } from '@purityjs/core/runtime';\\n`;",
  ["    : hydratable", "      ? `import { renderCompiledTemplate as ${prefix}_renderCompiled__, flattenValue as ${prefix}_fl__, swapSlot as ${prefix}_sw__ } from '@purityjs/core/runtime';\\n`", "      : `import { watch as ${prefix}_watch__ } from '@purityjs/core';\\nimport { flattenValue as ${prefix}_fl__, swapSlot as ${prefix}_sw__ } from '@purityjs/core/runtime';\\n`;"].join('\n'));
source = source.replace('Successfully compiled templates use precompiled factories and hydration walkers.', 'Client-only templates use create factories directly. Hydration walkers are opt-in.');
save(file, source);

// Existing tests retain their explicit hydratable/permissive contracts. The new
// suite exercises the breaking defaults, and all production CSR profiles use them.
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
for (const path of files) {
  if (!path.startsWith('packages/vite-plugin/tests/') || !path.endsWith('.ts') || path.endsWith('/client-first-aot.test.ts')) continue;
  const old = readFileSync(path, 'utf8');
  if (!old.includes('purity(')) continue;
  const { program, errors } = parseSync(path, old);
  assert.equal(errors.length, 0, `Cannot migrate test: ${path}`);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'CallExpression' && value.callee?.type === 'Identifier' && value.callee.name === 'purity') {
      if (value.arguments.length === 0) {
        edits.push({ start: value.start, end: value.end, text: 'purity({ hydratable: true, strictAot: false })' });
      } else if (value.arguments.length === 1 && value.arguments[0].type !== 'SpreadElement') {
        const arg = value.arguments[0];
        edits.push({ start: arg.start, end: arg.end, text: `{ hydratable: true, strictAot: false, ...(${old.slice(arg.start, arg.end)}) }` });
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(program);
  let next = old;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (next !== old) save(path, next);
}

// Migrate SSR scaffolds and the existing end-to-end hydration consumers. Pure
// dashboard/docs/benchmark builds remain on the smaller default unless they
// explicitly declare SSR or hydration use.
for (const path of files) {
  if (!/\.(?:ts|js|mjs)$/.test(path)) continue;
  if (path.startsWith('packages/vite-plugin/') || path === file || path.startsWith('scripts/dev-') || path.startsWith('benchmark/bundle-size/')) continue;
  const old = readFileSync(path, 'utf8');
  if (!old.includes('purity(')) continue;
  const needsHydration =
    path.startsWith('benchmark/tools/') ||
    path.startsWith('packages/ssr/tests/') ||
    (path.startsWith('packages/cli/') && /(?:ssr|template\/app)/.test(path)) ||
    (path.startsWith('examples/') && /(?:ssr|hydrat|island)/i.test(path + '\n' + old));
  if (!needsHydration) continue;
  let next = old.replace(/\bpurity\(\s*\)/g, 'purity({ hydratable: true })');
  next = next.replace(/\bpurity\(\s*\{(?!\s*hydratable:)/g, 'purity({ hydratable: true, ');
  if (next !== old) save(path, next);
}

// Preserve the old full-hydration profiles. Add client-only versions using the
// SAME fixture sources, and make mode identity part of the schema-5 contract.
const budgetsPath = 'benchmark/bundle-size/budgets.json';
const budgetsSource = readFileSync(budgetsPath, 'utf8');
save('benchmark/bundle-size/budgets-v4.json', budgetsSource);
const budgets = JSON.parse(budgetsSource);
const csrNames = ['counter', 'counter-client', 'controls', 'form', 'resource'];
for (const name of csrNames) budgets.fixtures[`${name}-csr-aot`] = { functionConstructorCalls: 0 };
save(budgetsPath, JSON.stringify(budgets, null, 2) + '\n');
let measure = readFileSync('benchmark/bundle-size/measure.ts', 'utf8');
measure = one(measure, '  profile: string;\n', "  profile: string;\n  compilation: 'jit' | 'hydrate' | 'client';\n");
measure = one(measure, '  aot: boolean,\n): Promise<Measurement>', '  aot: boolean,\n  clientOnly = false,\n): Promise<Measurement>');
measure = one(measure, 'purity({ strictAot: true })', 'purity({ strictAot: true, hydratable: !clientOnly })');
measure = one(measure, "const profile = `${scenario.name}-${aot ? 'aot' : 'runtime'}`;", "const profile = `${scenario.name}${clientOnly ? '-csr' : ''}-${aot ? 'aot' : 'runtime'}`;");
measure = one(measure, '    profile,\n    ...total,', "    profile,\n    compilation: aot ? (clientOnly ? 'client' : 'hydrate') : 'jit',\n    ...total,");
measure = one(measure, '  measurements.push(await measure(scenario, false), await measure(scenario, true));', "  measurements.push(await measure(scenario, false), await measure(scenario, true));\n  if (scenario.name !== 'hydration') measurements.push(await measure(scenario, true, true));");
measure = one(measure, '  schemaVersion: 4,', '  schemaVersion: 5,');
save('benchmark/bundle-size/measure.ts', measure);

let compare = readFileSync('benchmark/bundle-size/compare-reports.ts', 'utf8');
compare = one(compare, "import currentBudgets from './budgets.json' with { type: 'json' };", "import currentBudgets from './budgets.json' with { type: 'json' };\nimport v4Budgets from './budgets-v4.json' with { type: 'json' };");
compare = one(compare, '  profile?: string;', "  profile?: string;\n  compilation?: 'jit' | 'hydrate' | 'client';");
compare = one(compare, "const profileNamesV4 = [...profileNames, 'counter-client-runtime', 'counter-client-aot'];", "const profileNamesV4 = [...profileNames, 'counter-client-runtime', 'counter-client-aot'];\nconst profileNamesV5 = [...profileNamesV4, ...['counter', 'counter-client', 'controls', 'form', 'resource'].map((name) => name + '-csr-aot')];");
compare = one(compare, 'report.schemaVersion === 3 || report.schemaVersion === 4,', 'report.schemaVersion === 3 || report.schemaVersion === 4 || report.schemaVersion === 5,');
compare = one(compare, 'const expanded = report.schemaVersion === 4;', 'const expanded = report.schemaVersion >= 4;');
compare = one(compare, 'normalized(expanded ? currentBudgets : legacyBudgets)', 'normalized(report.schemaVersion === 5 ? currentBudgets : expanded ? v4Budgets : legacyBudgets)');
compare = one(compare, 'expanded ? profileNamesV4 : profileNames,', 'report.schemaVersion === 5 ? profileNamesV5 : expanded ? profileNamesV4 : profileNames,');
compare = one(compare, "  for (const row of report.measurements) allChunks(row, label + '/' + row.profile);", "  for (const row of report.measurements) {\n    allChunks(row, label + '/' + row.profile);\n    if (report.schemaVersion === 5) {\n      const expected = row.profile!.endsWith('-csr-aot') ? 'client' : row.profile!.endsWith('-aot') ? 'hydrate' : 'jit';\n      assert.equal(row.compilation, expected, 'Missing or changed compilation mode: ' + label + '/' + row.profile);\n    }\n  }");
compare = one(compare, '      const next = b.get(name)!;\n', "      const next = b.get(name)!;\n      assert.equal(old.compilation, next.compilation, 'INCOMPARABLE: changed compilation mode for ' + name);\n");
save('benchmark/bundle-size/compare-reports.ts', compare);

const testPath = 'benchmark/tools/compare-size-reports.test.ts';
let tests = readFileSync(testPath, 'utf8');
tests = one(tests, "import currentBudgets from '../bundle-size/budgets.json' with { type: 'json' };", "import currentBudgets from '../bundle-size/budgets-v4.json' with { type: 'json' };\nimport clientBudgets from '../bundle-size/budgets.json' with { type: 'json' };");
tests += `\nfunction clientExamples() {\n  const { base, next } = expandedExamples();\n  for (const report of [base, next]) {\n    report.schemaVersion = 5;\n    report.budgets = structuredClone(clientBudgets);\n    for (const name of ['counter', 'counter-client', 'controls', 'form', 'resource']) {\n      report.measurements.push({ profile: name + '-csr-aot', rawBytes: 100, gzipBytes: 50, brotliBytes: 40, functionConstructorCalls: 0, chunks: [{ file: 'entry.js', rawBytes: 100, gzipBytes: 50, brotliBytes: 40 }] });\n    }\n    for (const row of report.measurements) Object.assign(row, { compilation: row.profile.endsWith('-csr-aot') ? 'client' : row.profile.endsWith('-aot') ? 'hydrate' : 'jit' });\n  }\n  return { base, next };\n}\n\nit('requires all 17 v5 application profiles with explicit compilation modes', () => {\n  const { base } = clientExamples();\n  expect(compareSizeReports(base, structuredClone(base)).apps).toHaveLength(17);\n  const missing = structuredClone(base);\n  missing.measurements = missing.measurements.filter((row) => row.profile !== 'form-csr-aot');\n  expect(() => compareSizeReports(missing, structuredClone(missing))).toThrow(/Incomplete v5 coverage/);\n  const wrongMode = structuredClone(base);\n  Object.assign(wrongMode.measurements.find((row) => row.profile === 'form-csr-aot')!, { compilation: 'hydrate' });\n  expect(() => compareSizeReports(wrongMode, structuredClone(wrongMode))).toThrow(/compilation mode/);\n});\n\nit('keeps client mode and historical full-hydration evidence distinct', () => {\n  const { base: old } = expandedExamples();\n  const { base: current } = clientExamples();\n  expect(() => compareSizeReports(old, current)).toThrow(/INCOMPARABLE: changed schemaVersion/);\n});\n\nit.each(['rawBytes', 'gzipBytes', 'brotliBytes'] as const)('reports client-only full-app and chunk %s growth', (metric) => {\n  const { base } = clientExamples();\n  const next = structuredClone(base);\n  const app = next.measurements.find((row) => row.profile === 'controls-csr-aot')!;\n  app[metric]++;\n  app.chunks[0][metric]++;\n  const result = compareSizeReports(base, next);\n  expect(result.appGrowth.map((row) => row.name)).toContain('controls-csr-aot');\n  expect(result.chunkGrowth.map((row) => row.name)).toContain('controls-csr-aot/entry.js');\n});\n`;
save(testPath, tests);

const migration = `# Client-first AOT: breaking migration\n\nPurity's default Vite build is now strict client-only AOT. The compiler generates create/update factories directly; it does not generate template hydration walkers or call the runtime hydration selector for these templates. No runtime parser or code generator is permitted in a strict production build.\n\n## Choose by application behavior\n\n- Pure client application or widget: use \`purity()\`.\n- SSR client, hydrated island or a component library whose views must adopt server DOM: use \`purity({ hydratable: true })\` in the client compilation. Server transforms still produce SSR output.\n- Deliberate runtime-template fallback: opt into \`strictAot: false\`; this does not remove the requirement to opt into hydration separately.\n\nThis intentionally breaks the previous implicit hydration and permissive-AOT defaults. There is no automatic compatibility fallback. Rebuild precompiled component libraries with the correct mode; do not use client-only compiled views as hydration views.\n\nThe existing hydration runtime remains for applications that use it, not as a shim in every generated template. Shared control-flow, component and lifecycle modules may still contain hydration coordination. This change is not a claim that every hydration-related byte is absent from every client application. It changes generated program dependencies rather than renaming npm packages. URL validation, ownership, forms, custom elements and SSR features are not removed.\n\n## Reproducible acceptance\n\nThe original 14 package entries and 12 full-hydration/JIT application profiles remain measured. Schema 5 adds five same-source client-only AOT profiles (counter, client-JIT-import counter, keyed controls, form and resource), each with explicit compilation identity and every emitted JS chunk. The SSR/hydration workload never opts out of hydration. Original v3/v4 schemas and budgets remain frozen. Three-browser verification runs every profile, including CSP for all AOT profiles.\n\nCompare client-only and hydratable builds only for workloads that do not require hydration. Do not relabel that mode choice as a reduction in the all-feature core, and do not add independent application payloads together as one download. The frozen core-all 40,679 B baseline, <=34,577 B goal and original hard caps are unchanged. This work alone does not establish Solid v2 parity, speed, allocation or retained-heap improvements.\n`;
save('docs/client-first-aot.md', migration);
let readme = readFileSync('packages/vite-plugin/README.md', 'utf8');
const lineEnd = readme.indexOf('\n');
readme = readme.slice(0, lineEnd + 1) + '\n**Breaking default:** `purity()` now produces strict client-only AOT. SSR clients and hydrated component libraries must explicitly use `purity({ hydratable: true })`. Runtime fallback requires `strictAot: false`. See [migration and complete-application evidence](../../docs/client-first-aot.md).\n' + readme.slice(lineEnd + 1);
save('packages/vite-plugin/README.md', readme);
let agents = readFileSync('packages/vite-plugin/AGENTS.md', 'utf8');
agents = agents.replace('// Client output hoists both a DOM factory and a hydration walker.', '// With hydratable: true, client output hoists a DOM factory and hydration walker.');
agents += '\n## Client-first default (breaking)\n\n`purity()` uses strict client-only AOT. It emits create-factory calls with shared `watch`, without hydration walkers or `renderCompiledTemplate`. Use `hydratable: true` for SSR clients and hydrated component libraries. Only explicit `strictAot: false` allows runtime fallback. Preserve all original behavior tests in their declared mode and exercise the default client mode independently.\n';
save('packages/vite-plugin/AGENTS.md', agents);
console.log('Implementation applied. No validation or byte-saving claim is implied by this step.');
