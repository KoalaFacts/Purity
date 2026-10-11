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
// conditional on private provenance rather than a forgeable JSON property.
// ---------------------------------------------------------------------------

/** A string of pre-escaped, trusted HTML. Concatenated raw by valueToHtml. */
export interface SSRHtml {
  readonly __purity_ssr_html__: string;
}

// External JSON must never gain raw-HTML privileges by copying a public field.
// Weak references allow wrappers to be collected after each render.
const trustedHtml = new WeakSet<object>();

/** Marks a string as already-escaped HTML safe to concatenate raw. */
export function markSSRHtml(s: string): SSRHtml {
  const wrapper = Object.freeze({ __purity_ssr_html__: s });
  trustedHtml.add(wrapper);
  return wrapper;
}

/** Type guard: true if x is a branded SSR HTML wrapper. */
export function isSSRHtml(x: unknown): x is SSRHtml {
  return x != null && typeof x === 'object' && trustedHtml.has(x);
}

/**
 * Escape a value for safe inclusion in HTML text content. Covers the OWASP
 * five-character set (`&`, `<`, `>`, `"`, `'`) — `"` and `'` aren't strictly
 * needed in text position, but escaping them makes the function safe to
 * reuse in attribute contexts and silences static-analysis warnings about
 * incomplete sanitization.
 */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a value for safe inclusion in a double-quoted attribute. */
export function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
 * - Arrays recurse and concatenate. A WeakSet tracks visited arrays so a
 *   cyclic structure (`const a:any=[]; a.push(a)`) renders as empty for the
 *   repeat occurrence instead of stack-overflowing the SSR render.
 * - Everything else is String()'d and HTML-escaped.
 */
export function valueToHtml(v: unknown): string {
  return valueToHtmlInner(v, null, true);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeRefs(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (!dec && !hex) return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    const cp = dec ? +dec : parseInt(hex, 16);
    // As the HTML parser: NUL, surrogates and out-of-range values become U+FFFD.
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
      ? '\uFFFD'
      : String.fromCodePoint(cp);
  });
}

/** Namespace an element's children are parsed in. */
export type Namespace = 'html' | 'svg' | 'math';

/**
 * Namespace for the children of a `tag` (lower-case) element that sits in
 * namespace `ns`, following the HTML parser's foreign-content rules: svg/math
 * enter their namespace from HTML; SVG foreignObject/desc/title and MathML
 * mi/mo/mn/ms/mtext are HTML integration points. When unsure (annotation-xml,
 * mglyph/malignmark anywhere) the answer stays foreign, because misreading
 * foreign content as HTML raw text would emit it unescaped.
 */
export function childNamespace(ns: Namespace, tag: string, parent?: string): Namespace {
  if (ns === 'math' && parent === 'annotation-xml' && tag === 'svg') return 'svg';
  if (ns === 'html') {
    if (tag === 'svg') return 'svg';
    return tag === 'math' || tag === 'mglyph' || tag === 'malignmark' ? 'math' : 'html';
  }
  if (ns === 'svg') return /^(?:foreignobject|desc|title)$/.test(tag) ? 'html' : 'svg';
  return /^(?:mi|mo|mn|ms|mtext)$/.test(tag) ? 'html' : 'math';
}

// Offset of the end tag `</tag` + whitespace, `/`, `>` or end (ASCII
// case-insensitive) at or after `from`, or the end of `html`.
export function rawEnd(html: string, from: number, tag: string): number {
  // `<name` / `</name` at i (ASCII case-insensitive) followed by whitespace,
  // `/`, `>` or the end.
  const tagAt = (i: number, name: string): boolean =>
    html.slice(i, i + name.length).toLowerCase() === name &&
    /^(?:[\t\n\f\r />]|$)/.test(html.charAt(i + name.length));
  // Script data states (script only): 0 data, 1 escaped (after `<!--`),
  // 2 double-escaped (after `<script` while escaped), where a `</script`
  // returns to escaped instead of ending the element. `-->` returns to data.
  let state = 0;
  for (let i = from; i < html.length; i++) {
    if (tag === 'script') {
      if (state === 0 && html.startsWith('<!--', i)) {
        state = 1;
        i += 3;
        continue;
      }
      if (state !== 0 && html.startsWith('-->', i)) {
        state = 0;
        i += 2;
        continue;
      }
      if (state === 1 && tagAt(i, '<script')) {
        state = 2;
        continue;
      }
    }
    if (tagAt(i, `</${tag}`)) {
      if (state !== 2) return i;
      state = 1;
    }
  }
  return html.length;
}

// Text content of SSR-rendered HTML, as the browser's textContent would read
// it. A tokenizer, not a tag-stripping regex: comments (hydration markers
// included) and tags are skipped, character references in text are decoded,
// and raw-text / RCDATA element content is read up to its own end tag (so a
// `<i>` inside a nested <style> stays text). The input is framework output,
// whose attribute values are escaped, so a tag never contains a bare `>`.
function htmlText(html: string): string {
  let out = '';
  let i = 0;
  // Open HTML <template> elements: their contents (declarative shadow roots
  // included) live in a separate fragment and are not part of textContent.
  let hidden = 0;
  // Namespace changes, innermost last: [tag, namespace of its children].
  // Outside HTML, style/script/title/textarea content is markup, not raw text.
  const stack: [string, Namespace][] = [];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (!hidden) out += decodeRefs(html.slice(i, lt === -1 ? html.length : lt));
    if (lt === -1) break;
    const ns: Namespace = stack.length > 0 ? stack[stack.length - 1][1] : 'html';
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    // CDATA is character data in foreign content (a bogus comment in HTML).
    if (ns !== 'html' && html.startsWith('<![CDATA[', lt)) {
      const close = html.indexOf(']]>', lt + 9);
      const end = close === -1 ? html.length : close;
      if (!hidden) out += html.slice(lt + 9, end);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    i = gt + 1;
    const m = /^<(\/?)([a-z][^\s/>]*)/i.exec(html.slice(lt, gt + 1));
    if (!m) continue;
    const tag = m[2].toLowerCase();
    const close = m[1] === '/';
    const selfClosing = html[gt - 1] === '/';
    if (close) {
      // Pop up to the matching open element, if any.
      let at = stack.length - 1;
      while (at >= 0 && stack[at][0] !== tag) at--;
      if (at >= 0) stack.length = at;
      else if (tag === 'template' && ns === 'html') hidden = Math.max(0, hidden - 1);
      continue;
    }
    if (selfClosing) continue;
    if (tag === 'template' && ns === 'html') {
      hidden++;
      continue;
    }
    const inner = childNamespace(ns, tag, stack[stack.length - 1]?.[0]);
    if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) {
      stack.push([tag, inner]);
    }
    if (ns === 'html') {
      // The parser drops one newline right after these start tags.
      if ((tag === 'textarea' || tag === 'pre' || tag === 'listing') && html[i] === '\n') i++;
      // Raw text (as a scripting-enabled browser parses it) and RCDATA.
      if (/^(?:style|script|xmp|iframe|noembed|noframes|noscript|textarea|title)$/.test(tag)) {
        const end = rawEnd(html, i, tag);
        let text = html.slice(i, end);
        if (tag === 'textarea' || tag === 'title') text = decodeRefs(text);
        // Undo the CSS escape valueToRawText writes for `<`.
        else if (tag === 'style') text = text.split('\\3c ').join('<');
        if (!hidden) out += text;
        i = end;
      }
    }
  }
  return out;
}

/**
 * Same coercion as valueToHtml for the content of a raw-text or RCDATA element,
 * where the HTML parser makes everything one text node: a nested template
 * contributes its text content, as it does on the client. For RCDATA
 * (`<textarea>`, `<title>`, `rcdata` set) the text is HTML-escaped. For
 * raw-text (`<style>`; dynamic `<script>` content is rejected) entities are not
 * decoded, so every `<` is written as the CSS escape `\3c ` instead. The output
 * then contains no `<` at all, so it cannot form a tag in whatever context the
 * browser parses it: raw text, foreign (SVG/MathML) content, or an ancestor
 * such as <xmp> or <noscript> that this element was nested in, including a
 * parent template it is spliced into at runtime. CSS reads `\3c ` as `<` in
 * strings and identifiers; textContent differs from the client until hydration.
 */
export function valueToRawText(parts: unknown[], rcdata?: unknown): string {
  // Each part is one template slot (or static text): coerce them separately so
  // cycle tracking does not carry across slots, then escape the joined text.
  let text = '';
  for (let i = 0; i < parts.length; i++) text += valueToHtmlInner(parts[i], null, false);
  if (rcdata) return escHtml(text);
  // An odd run of backslashes before `<` already escapes it in CSS (`\<` is
  // `<`): drop that backslash so the escape is not itself escaped.
  return text.replace(
    /(\\*)</g,
    (_, slashes: string) => `${slashes.length % 2 ? slashes.slice(1) : slashes}\\3c `,
  );
}

// `html` false: text mode for raw content (no escaping; nested SSR HTML
// becomes its text content).
function valueToHtmlInner(v: unknown, seen: WeakSet<object> | null, html: boolean): string {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return '';
  if (isSSRHtml(v)) return html ? v.__purity_ssr_html__ : htmlText(v.__purity_ssr_html__);
  if (Array.isArray(v)) {
    // Lazily allocate the visited set — non-cyclic input keeps the fast path
    // allocation-free; only arrays pay the WeakSet add cost.
    if (seen === null) seen = new WeakSet<object>();
    if (seen.has(v)) return '';
    seen.add(v);
    let s = '';
    for (let i = 0; i < v.length; i++) s += valueToHtmlInner(v[i], seen, html);
    return s;
  }
  return html ? escHtml(String(v)) : String(v);
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

// ---------------------------------------------------------------------------
// Custom-element / component dispatch
//
// Codegen emits `_h.element(tag, attrs, slotHtml)` for any hyphenated tag.
// The helper:
//   1. Asks the SSR component renderer (installed by @purityjs/ssr on import)
//      whether the tag is a registered component.
//   2. If yes, the renderer returns the full DSD-wrapped HTML.
//   3. If no, falls back to plain custom-element markup (host attrs + slot
//      children, no shadow tree). This handles unregistered third-party web
//      components gracefully.
//
// The hook indirection avoids an import cycle: ssr-runtime is in core (used
// by the codegen output), elements.ts also lives in core, and @purityjs/ssr
// owns the actual SSR-context machinery and CSS-capture logic.
// ---------------------------------------------------------------------------

/** Renderer hook signature. Returns DSD-wrapped HTML, or null if `tag` is not a registered component. */
export type SSRComponentRenderer = (
  tag: string,
  attrs: Record<string, unknown>,
  slotHtml: string,
) => string | null;

let componentRenderer: SSRComponentRenderer | null = null;

/**
 * Install the SSR component renderer. Called by `@purityjs/ssr` on import.
 *
 * Idempotent: re-installing the same function reference (or clearing to
 * `null` when already cleared) is a silent no-op. This guards against
 * harmless double-imports of `@purityjs/ssr` (test setup churn, bundler
 * dedup glitches, ESM dual instantiation).
 *
 * Throws when called with a *different* non-null renderer while one is
 * already installed — a real conflict between two SSR implementations
 * surfaces loudly instead of silently last-write-wins. Pass `null`
 * first to explicitly hand off.
 */
export function setSSRComponentRenderer(fn: SSRComponentRenderer | null): void {
  if (componentRenderer === fn) return;
  if (componentRenderer !== null && fn !== null) {
    throw new Error(
      'setSSRComponentRenderer: a different renderer is already installed. ' +
        'This usually means `@purityjs/ssr` was loaded twice (e.g. ESM dual ' +
        'instantiation or a bundler dedup glitch). Reset to null before ' +
        'installing a new renderer.',
    );
  }
  componentRenderer = fn;
}

// HTML attribute / tag name shape used as a defense-in-depth filter on the
// public `_h.element` entry point. The codegen path already runs every
// attribute and tag name through assertSafeName at compile time, but
// `ssrElement` is exported via `ssrHelpers` and a third-party
// `SSRComponentRenderer` can fall through to `plainElement` with caller-
// controlled keys (e.g. spread props from a fetched JSON payload). An
// attacker-supplied key containing `=`, space, `/`, or `>` would otherwise
// break out of the attribute name into raw HTML — silently skipping
// non-conforming keys keeps the fallback safe regardless of who calls it.
const SAFE_ATTR_NAME = /^[A-Za-z_][A-Za-z0-9_\-:.]*$/;

/**
 * Plain element fallback — emits `<tag attr="…">slot</tag>` with proper escaping.
 * Used when no component renderer is registered or when the tag is unknown.
 */
function plainElement(tag: string, attrs: Record<string, unknown>, slotHtml: string): string {
  let s = `<${tag}`;
  for (const k of Object.keys(attrs)) {
    if (!SAFE_ATTR_NAME.test(k)) continue;
    const av = valueToAttr(attrs[k]);
    if (av !== null) s += av === '' ? ` ${k}` : ` ${k}="${av}"`;
  }
  // Custom elements are never void elements per the HTML spec — always emit
  // an explicit closing tag even if `slotHtml` is empty.
  return `${s}>${slotHtml}</${tag}>`;
}

/** Render a hyphenated element tag, dispatching to a registered component if any. */
export function ssrElement(tag: string, attrs: Record<string, unknown>, slotHtml: string): string {
  if (componentRenderer) {
    const result = componentRenderer(tag, attrs, slotHtml);
    if (result !== null) return result;
  }
  return plainElement(tag, attrs, slotHtml);
}

/** Helpers bundle passed as the second argument to SSR-compiled factories. */
export const ssrHelpers = {
  esc: escHtml,
  attr: escAttr,
  toHtml: valueToHtml,
  rawText: valueToRawText,
  toAttr: valueToAttr,
  isHtml: isSSRHtml,
  mark: markSSRHtml,
  element: ssrElement,
} as const;

export type SSRHelpers = typeof ssrHelpers;
