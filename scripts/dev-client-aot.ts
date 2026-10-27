import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Reuse this branch's immutable, already inspected migration script rather than
// copying a 14 KB source rewrite again. Only the observed signature anchor changes.
const revision = '8c52bca123f595d4380bc1288a732e70860d521c';
execFileSync('git', ['fetch', '--depth=1', 'origin', revision], { stdio: 'inherit' });
let script = execFileSync('git', ['show', revision + ':scripts/dev-client-aot.ts'], { encoding: 'utf8' });
const before = "'  aot: boolean,\\n): Promise<Measurement>'";
const after = "'  aot: boolean,\\n  clientOnly = false,\\n): Promise<Measurement>'";
assert.equal(script.split(before).length - 1, 1);
assert.equal(script.split(after).length - 1, 1);
script = script.replace(before, "'aot: boolean): Promise<Measurement>'");
script = script.replace(after, "'aot: boolean, clientOnly = false): Promise<Measurement>'");
const temporary = 'scripts/.dev-client-aot-exec.ts';
writeFileSync(temporary, script);
try {
  execFileSync(process.execPath, [temporary], { stdio: 'inherit' });
} finally {
  unlinkSync(temporary);
}

// These CSR apps mention islands only in alias tables, not as an SSR workload.
// Keep them exercising the actual new default, not the migration's SSR opt-in.
for (const file of ['examples/dashboard/vite.config.ts', 'examples/docs-site/vite.config.ts']) {
  writeFileSync(file, execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' }));
}
const path = 'packages/vite-plugin/README.md';
let readme = readFileSync(path, 'utf8');
readme = readme.replace('By default, nonfatal compilation failures warn and preserve the runtime tag.\nEnable `strictAot` to make these failures fatal and check client build output.', 'By default, compilation failures stop the build and client output must not retain the runtime compiler. Only explicit `strictAot: false` permits nonfatal warning-and-JIT fallback.');
readme = readme.replace('strictAot: true, // fail compilation and reject retained client JIT code (default: false)', 'strictAot: true, // fail compilation and reject retained client JIT code (default: true)\n  hydratable: false, // opt in only for SSR clients or hydrated component libraries');
readme = readme.replace("That's it. No other config needed.", 'This is the client-only setup. For an SSR client, use `purity({ hydratable: true })`; otherwise compiled templates do not adopt server DOM.');
readme = readme.replace('Opt in in your Vite configuration:', 'Strict AOT is the default; the explicit form is:');
readme = readme.replace('underlying error and a repair hint. This includes nested templates. The default\n`strictAot: false` keeps the existing warning-and-JIT fallback for nonfatal errors;', 'underlying error and a repair hint. This includes nested templates. Explicit\n`strictAot: false` permits warning-and-JIT fallback for nonfatal errors;');
readme = readme.replace('7. Imports the precompiled factory/hydration helpers from `@purityjs/core/runtime`', '7. Calls client create factories with the shared `watch` implementation by default; only `hydratable: true` emits hydration walkers and the mode-selecting runtime helper');
writeFileSync(path, readme);
console.log('Observed signature corrected; CSR examples and breaking-default documentation reconciled.');
