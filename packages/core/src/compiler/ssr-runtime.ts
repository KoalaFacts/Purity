// ---------------------------------------------------------------------------
// Purity SSR Runtime — string-rendering helpers shared between the SSR codegen
// output and the SSR-aware control-flow variants.
//
// generateSSR() emits factories of shape `(values, _h) => string`. The _h
// parameter is this module's default export (`ssrHelpers`). Keeping helpers in
// a parameter (instead of free identifiers) means the emitted source needs no
// external symbol resolution — matching the existing `(values, _w)` calling
// convention used by client codegen.
//
// `__purity_ssr_html__` brand: nested `html``, control-flow returns, and
// component subtree results all carry this brand. valueToHtml() concatenates
// branded values raw and escapes everything else, making HTML injection
// impossible without explicit branding.
// ---------------------------------------------------------------------------

/** A string of pre-escaped, trusted HTML. Concatenated raw by valueToHtml. */
export interface SSRHtml {
  __purity_ssr_html__: string;
}

/** Marks a string as already-escaped HTML safe to concatenate raw. */
export function markSSRHtml(s: string): SSRHtml {
  return { __purity_ssr_html__: s };
}

/** Type guard: true if x is a branded SSR HTML wrapper. */
export function isSSRHtml(x: unknown): x is SSRHtml {
  return (
    x != null &&
    typeof x === 'object' &&
    typeof (x as { __purity_ssr_html__?: unknown }).__purity_ssr_html__ === 'string'
  );
}

/** Escape a value for safe inclusion in HTML text content. */
export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value for safe inclusion in a double-quoted attribute. */
export function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Hydration markers wrap each reactive expression slot in SSR output so the
// client-side hydrator can find binding sites without positional path drift
// from text-node coalescing in the HTML parser. The pair is 14 bytes per
// expression; PR 4 will consume and strip them.
export const HYDRATION_OPEN = '<!--[-->';
export const HYDRATION_CLOSE = '<!--]-->';

/**
 * Convert any value to HTML text. Used by SSR codegen to render expression
 * slots and by SSR control-flow helpers to assemble item HTML.
 *
 * - Functions are called once (signal accessor → current value).
 * - Branded SSR HTML wrappers concatenate raw.
 * - null / undefined / false render as empty string.
 * - Arrays recurse and concatenate.
 * - Everything else is String()'d and HTML-escaped.
 */
export function valueToHtml(v: unknown): string {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return '';
  if (isSSRHtml(v)) return v.__purity_ssr_html__;
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) s += valueToHtml(v[i]);
    return s;
  }
  return escHtml(String(v));
}

/**
 * Convert any value to attribute text. Same coercion as valueToHtml but uses
 * attribute escaping. Returns null when the attribute should be omitted
 * entirely (null / undefined / false).
 */
export function valueToAttr(v: unknown): string | null {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return null;
  if (v === true) return '';
  return escAttr(String(v));
}

/** Helpers bundle passed as the second argument to SSR-compiled factories. */
export const ssrHelpers = {
  esc: escHtml,
  attr: escAttr,
  toHtml: valueToHtml,
  toAttr: valueToAttr,
  isHtml: isSSRHtml,
  mark: markSSRHtml,
} as const;

export type SSRHelpers = typeof ssrHelpers;
