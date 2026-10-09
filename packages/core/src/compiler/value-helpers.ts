// ---------------------------------------------------------------------------
// Client-side value coercion shared by every generated binding site (CSR and
// hydrate). Generated code receives these as the free names
// `__purity_fl__` / `__purity_tx__`: compile.ts binds them for JIT factories,
// and the AOT plugin imports them into compiled modules. Keeping them here
// (instead of inlining them per template) means each template pays only for
// the call sites it uses.
//
// MUST mirror valueToHtml() in ssr-runtime.ts: functions are called,
// null/undefined/false vanish, arrays flatten (a repeated array is skipped, as
// SSR's visited-set does), everything else is String()'d.
// ---------------------------------------------------------------------------

/** Collect the leaf values of `v` into `out`, calling functions and flattening arrays. */
export function flattenValue(v: unknown, out: unknown[], seen: unknown[]): unknown[] {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return out;
  if (Array.isArray(v)) {
    if (seen.indexOf(v) >= 0) return out;
    seen.push(v);
    for (let i = 0; i < v.length; i++) flattenValue(v[i], out, seen);
  } else {
    out.push(v);
  }
  return out;
}

/** Render a value as text using the SSR coercion rules. */
export function valueText(v: unknown): string {
  if (v == null || v === false) return '';
  if (typeof v !== 'object' && typeof v !== 'function') return String(v);
  const leaves = flattenValue(v, [], []);
  let s = '';
  for (let i = 0; i < leaves.length; i++) s += String(leaves[i]);
  return s;
}
