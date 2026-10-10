// ---------------------------------------------------------------------------
// Client-side value coercion shared by every generated binding site (CSR and
// hydrate). Generated code receives these as the free names
// `__purity_fl__` / `__purity_tx__`: compile.ts binds them for JIT factories,
// and the AOT plugin imports them into compiled modules. Keeping them here
// (instead of inlining them per template) means each template pays only for
// the call sites it uses.
//
// MUST mirror valueToHtml() in ssr-runtime.ts: a function is called once and
// its result is not called again; null/undefined/false vanish; arrays flatten
// (a repeated or cyclic array is skipped, as SSR's visited-set does);
// everything else is String()'d.
// ---------------------------------------------------------------------------

/**
 * Collect the leaf values of `v` into `out`, calling a function item once and
 * flattening arrays. `seen` is allocated on the first array, so values without
 * arrays stay allocation-free.
 */
export function flattenValue(v: unknown, out: unknown[], seen: WeakSet<object> | null): unknown[] {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return out;
  if (Array.isArray(v)) {
    if (seen === null) seen = new WeakSet<object>();
    if (seen.has(v)) return out;
    seen.add(v);
    for (let i = 0; i < v.length; i++) flattenValue(v[i], out, seen);
  } else {
    out.push(v);
  }
  return out;
}

/**
 * Render an already-resolved value as text. The value is not called here: the
 * binding has called the accessor once, and SSR does not call the result.
 */
export function valueText(v: unknown): string {
  if (v == null || v === false) return '';
  if (!Array.isArray(v)) return String(v);
  const leaves = flattenValue(v, [], null);
  let s = '';
  for (let i = 0; i < leaves.length; i++) s += String(leaves[i]);
  return s;
}
