// SV2-012 CI prerequisite: keep Svelte fixture builds on a patched,
// drop-in merge implementation instead of vulnerable deepmerge@4.3.1.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Resolve from the benchmark plugin itself, rather than relying on npm hoisting.
const fromPlugin = createRequire(import.meta.resolve('@sveltejs/vite-plugin-svelte'));
type ArrayMerge = (target: unknown[], source: unknown[]) => unknown[];
const merge = fromPlugin('deepmerge') as (
  a: unknown,
  b: unknown,
  options?: { arrayMerge?: ArrayMerge },
) => any;

const hostile = JSON.parse('{"config":{"__proto__":{"admin":true}},"list":[2]}');
const merged = merge({ config: { safe: true }, list: [1] }, hostile);
assert.equal(merged.config.safe, true);
assert.equal(merged.config.admin, undefined);
assert.equal(Object.getPrototypeOf(merged.config), Object.prototype);
assert.equal(Object.prototype.hasOwnProperty.call(merged.config, '__proto__'), false);
assert.deepEqual(merged.list, [1, 2]);

// Regression for CVE-2026-93753: ordinary-object targets do not trigger the
// vulnerable path. A null target lets the old deepmerge change the returned
// nested object's prototype instead of copying an own "__proto__" key.
const poisonedSource = JSON.parse('{"session":{"__proto__":{"admin":true}}}');
const poisoned = merge({ session: null }, poisonedSource);
assert.equal(poisoned.session.admin, undefined);
assert.equal(Object.getPrototypeOf(poisoned.session), Object.prototype);
assert.equal(Object.prototype.hasOwnProperty.call(poisoned.session, '__proto__'), false);

// Svelte's actual merge option replaces, rather than concatenates arrays.
// Verify the replacement library honors options provided by Svelte.
const svelteStyle = merge(
  { list: [1] },
  { list: [2] },
  { arrayMerge: (target: unknown[], source: unknown[]) => source ?? target },
);
assert.deepEqual(svelteStyle.list, [2]);
assert.equal(({} as { admin?: boolean }).admin, undefined);
console.log('Svelte tooling merge: prototype safe and standard options preserved.');
