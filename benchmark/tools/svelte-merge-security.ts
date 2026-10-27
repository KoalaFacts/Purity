// SV2-012 CI prerequisite: keep Svelte fixture builds on a patched,
 // drop-in merge implementation instead of vulnerable deepmerge@4.3.1.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Resolve from the benchmark plugin itself, rather than relying on npm hoisting.
const fromPlugin = createRequire(import.meta.resolve('@sveltejs/vite-plugin-svelte'));
const merge = fromPlugin('deepmerge') as (a: unknown, b: unknown) => any;

const hostile = JSON.parse('{"config":{"__proto__":{"admin":true}},"list":[2]}');
const merged = merge({ config: { safe: true }, list: [1] }, hostile);
assert.equal(merged.config.safe, true);
assert.equal(merged.config.admin, undefined);
assert.equal(Object.getPrototypeOf(merged.config), Object.prototype);
assert.equal(Object.prototype.hasOwnProperty.call(merged.config, '__proto__'), false);
assert.deepEqual(merged.list, [1, 2]);
assert.equal(({} as { admin?: boolean }).admin, undefined);
console.log('Svelte tooling merge: prototype safe and standard options preserved.');
