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

import { getSSRRenderContext } from '../ssr-context.ts';
import { VOID_TAGS } from './ast.ts';
import { namedReferences } from './character-references.ts';

/** A string of pre-escaped, trusted HTML. Concatenated raw by valueToHtml. */
export interface SSRHtml {
  readonly __purity_ssr_html__: string;
}

// External JSON must never gain raw-HTML privileges by copying a public field.
// Weak references allow wrappers to be collected after each render.
// Styles retain original text; component ranges retain original slot markup
// with its own relative spans, rather than the rendered shadow subtree.
export type RawTextSpan = readonly [
  start: number,
  end: number,
  text: string,
  children?: readonly RawTextSpan[],
  boundary?: number,
];
const emptySpans: readonly RawTextSpan[] = [];
const trustedHtml = new WeakMap<object, readonly RawTextSpan[]>();

/** Transfer original text offsets when an SSR fragment gains a prefix. @internal */
export function appendRawTextSpans(
  source: readonly RawTextSpan[],
  target: RawTextSpan[],
  offset: number,
): void {
  for (let i = 0; i < source.length; i++) {
    const span = source[i];
    target.push([offset + span[0], offset + span[1], span[2], span[3], span[4]]);
  }
}

/** Marks a string as already-escaped HTML safe to concatenate raw. */
export function markSSRHtml(s: string, spans?: readonly RawTextSpan[]): SSRHtml {
  const wrapper = Object.freeze({ __purity_ssr_html__: s });
  trustedHtml.set(
    wrapper,
    spans?.length ? spans.map((span): RawTextSpan => [...span]) : emptySpans,
  );
  return wrapper;
}

/** Type guard: true if x is a branded SSR HTML wrapper. */
export function isSSRHtml(x: unknown): x is SSRHtml {
  // WeakMap.has returns false for primitives and only accepts wrappers we marked.
  return trustedHtml.has(x as object);
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
export const escAttr = escHtml;

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
export function valueToHtml(v: unknown, spans?: RawTextSpan[], offset = 0): string {
  return valueToHtmlInner(v, null, true, spans, offset);
}

// HTML's numeric-reference replacement table (the Windows-1252 range).
const numericReplacements = [
  8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143, 144, 8216,
  8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376,
];

function decodeRefs(text: string, attribute = false): string {
  return text.replace(
    /&(?:#(\d+);?|#[xX]([\da-fA-F]+);?|([A-Za-z][A-Za-z\d]{0,31};?))/g,
    (m, dec, hex, name: string | undefined, offset: number) => {
      if (name) {
        // Longest case-sensitive match, including legacy semicolonless names.
        // The bounded search cannot retry arbitrary input-length prefixes.
        for (let end = name.length; end > 0; end--) {
          const key = name.slice(0, end);
          if (Object.hasOwn(namedReferences, key)) {
            if (
              attribute &&
              !key.endsWith(';') &&
              /[=A-Za-z\d]/.test(name[end] ?? text.charAt(offset + m.length))
            )
              return m;
            return namedReferences[key] + name.slice(end);
          }
        }
        return m;
      }
      const cp = dec ? +dec : parseInt(hex, 16);
      // As the HTML parser: NUL, surrogates and out-of-range values become U+FFFD.
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? '\uFFFD'
        : String.fromCodePoint(cp >= 128 && cp <= 159 ? numericReplacements[cp - 128] : cp);
    },
  );
}

// HTML attribute values may be quoted or unquoted; the first duplicate wins.
function htmlAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of source.matchAll(
    /([^\t\n\f\r "'<>/=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]+)))?/g,
  )) {
    const name = match[1].toLowerCase();
    if (!attrs.has(name))
      attrs.set(
        name,
        decodeRefs((match[2] ?? match[3] ?? match[4] ?? '').replace(/\r\n?/g, '\n'), true),
      );
  }
  return attrs;
}

// Only CDO tokens between top-level CSS rules are ignored by the CSS parser.
// Replacing those with a comment preserves token boundaries without emitting
// an HTML comment opener when a style fragment is reused in foreign content.
function cssCDO(text: string): Set<number> {
  const positions = new Set<number>();
  let quote = '',
    comment = false,
    blocks = 0,
    groups = 0,
    betweenRules = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === '*' && text[i + 1] === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (c === '\\') {
      i++;
      if (!quote && !blocks) betweenRules = false;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      comment = true;
      i++;
      continue;
    }
    if (!blocks && !groups && betweenRules) {
      if (text.startsWith('<!--', i)) {
        positions.add(i);
        i += 3;
        continue;
      }
      if (text.startsWith('-->', i)) {
        i += 2;
        continue;
      }
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') groups++;
    else if (c === ')' || c === ']') groups = Math.max(0, groups - 1);
    else if (!groups && c === '{') blocks++;
    else if (!groups && c === '}') {
      blocks = Math.max(0, blocks - 1);
      if (!blocks) betweenRules = true;
      continue;
    } else if (!blocks && !groups && c === ';') {
      betweenRules = true;
      continue;
    }
    if (!blocks && !/[\t\n\f\r ]/.test(c)) betweenRules = false;
  }
  return positions;
}

/** Namespace an element's children are parsed in. */
export type Namespace = 'html' | 'svg' | 'math';

const svgAttributes = new Map(
  'attributeName attributeType baseFrequency baseProfile calcMode clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits numOctaves pathLength patternContentUnits patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur requiredExtensions requiredFeatures specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage tableValues targetX targetY textLength viewBox viewTarget xChannelSelector yChannelSelector zoomAndPan'
    .split(' ')
    .map((name) => [name.toLowerCase(), name]),
);

/** HTML foreign-attribute case and namespace adjustments. @internal */
export function foreignAttribute(name: string, ns: Namespace): [string, string?] {
  name = name.toLowerCase();
  const uri = /^xlink:(?:actuate|arcrole|href|role|show|title|type)$/.test(name)
    ? 'http://www.w3.org/1999/xlink'
    : /^xml:(?:lang|space)$/.test(name)
      ? 'http://www.w3.org/XML/1998/namespace'
      : /^(?:xmlns|xmlns:xlink)$/.test(name)
        ? 'http://www.w3.org/2000/xmlns/'
        : undefined;
  return [
    ns === 'svg'
      ? (svgAttributes.get(name) ?? name)
      : name === 'definitionurl'
        ? 'definitionURL'
        : name,
    uri,
  ];
}

/** Start tags that leave foreign content under the HTML tree-construction rules. */
export function foreignBreakout(tag: string, fontAttribute = false): boolean {
  return (
    /^(?:b|big|blockquote|body|br|center|code|dd|div|dl|dt|em|embed|h[1-6]|head|hr|i|img|li|listing|menu|meta|nobr|ol|p|pre|ruby|s|small|span|strong|strike|sub|sup|table|tt|u|ul|var)$/.test(
      tag,
    ) ||
    (tag === 'font' && fontAttribute)
  );
}

/** Actual element namespace, including the MathML text-integration exceptions. */
export function elementNamespace(
  ns: Namespace,
  tag: string,
  parent?: string,
  parentNS?: Namespace,
): Namespace {
  if (ns === 'html') {
    if (tag === 'svg' || tag === 'math') return tag;
    if (
      parentNS === 'math' &&
      /^m(?:[ions]|text)$/.test(parent ?? '') &&
      /^(?:mglyph|malignmark)$/.test(tag)
    )
      return 'math';
  } else if (ns === 'math' && parent === 'annotation-xml' && tag === 'svg') return 'svg';
  return ns;
}

/**
 * Namespace for the children of a `tag` (lower-case) element that sits in
 * namespace `ns`. SVG foreignObject/desc/title and MathML mi/mo/mn/ms/mtext
 * are HTML integration points. annotation-xml requires a known HTML encoding;
 * an unknown encoding stays foreign to avoid granting raw-text privileges.
 */
export function childNamespace(ns: Namespace, tag: string, encoding?: string): Namespace {
  if (ns === 'html') return 'html';
  if (ns === 'svg') return /^(?:foreignobject|desc|title)$/.test(tag) ? 'html' : 'svg';
  if (tag === 'annotation-xml' && /^(?:text\/html|application\/xhtml\+xml)$/i.test(encoding ?? ''))
    return 'html';
  return /^m(?:[ions]|text)$/.test(tag) ? 'html' : 'math';
}

// Offset of the end tag `</tag` + whitespace, `/`, `>` or end (ASCII
// case-insensitive) at or after `from`, or the end of `html`.
export function rawEnd(html: string, from: number, tag: string): number {
  // `<name` / `</name` at i (ASCII case-insensitive) followed by whitespace,
  // `/`, `>` or the end.
  const tagAt = (i: number, name: string): boolean =>
    html.slice(i, i + name.length).toLowerCase() === name &&
    /^[\t\n\f\r />]?$/.test(html.charAt(i + name.length));
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
// `<i>` inside a nested <style> stays text). Trusted public markup may contain
// any HTML attribute quoting form. Table output groups preserve foster order.
function htmlText(html: string, spans: readonly RawTextSpan[], hidden = 0): string {
  type TextGroup = (string | TextGroup)[];
  const output: TextGroup = [];
  let i = 0;
  let spanIndex = 0;
  let dropLF = false;
  const ctx = getSSRRenderContext();
  // Open HTML <template> elements: their contents (declarative shadow roots
  // included) live in a separate fragment and are not part of textContent.
  const hiddenBase = hidden;
  // Namespace changes, innermost last: [tag, namespace of its children].
  // Outside HTML, style/script/title/textarea content is markup, not raw text.
  const stack: [string, Namespace, Namespace, TextGroup, TextGroup?][] = [];
  const group = (): TextGroup => (stack.length ? stack[stack.length - 1][3] : output);
  // The nearest HTML table owns two ordered groups: fostered siblings, then
  // table descendants. A cell/caption suspends the table insertion mode.
  const table = () => {
    for (let at = stack.length - 1; at >= 0; at--) {
      const frame = stack[at];
      if (frame[2] !== 'html') continue;
      if (/^(?:td|th|caption)$/.test(frame[0])) return undefined;
      if (frame[0] === 'table') return frame;
    }
    return undefined;
  };
  const emit = (text: string, characters = true): void => {
    if (dropLF) {
      if (text.startsWith('\n')) text = text.slice(1);
      dropLF = false;
    }
    if (hidden || !text) return;
    const current = stack[stack.length - 1];
    const foster =
      characters &&
      current?.[2] === 'html' &&
      /^(?:table|tbody|tfoot|thead|tr)$/.test(current[0]) &&
      /[^\t\n\f\r ]/.test(text)
        ? table()?.[4]
        : undefined;
    (foster ?? group()).push(text);
  };
  while (i < html.length) {
    while (spanIndex < spans.length && spans[spanIndex][0] < i) spanIndex++;
    const direct = spans[spanIndex];
    if (direct?.[0] === i && direct[4] === undefined && !direct[3]) {
      emit(direct[2]);
      i = direct[1];
      spanIndex++;
      continue;
    }
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    if (direct && !direct[3] && direct[4] === undefined && direct[0] < textEnd) {
      emit(decodeRefs(html.slice(i, direct[0]).replace(/\r\n?/g, '\n')));
      i = direct[0];
      continue;
    }
    // HTML input preprocessing happens before references are decoded, so
    // literal CR/CRLF normalizes but an authored &#13; still yields CR.
    if (textEnd > i) emit(decodeRefs(html.slice(i, textEnd).replace(/\r\n?/g, '\n')));
    dropLF = false;
    if (lt === -1) break;
    // A component's detached client host exposes its original light DOM,
    // rather than the slot's rendered location inside the shadow template.
    while (spanIndex < spans.length && spans[spanIndex][0] < lt) spanIndex++;
    const span = spans[spanIndex];
    if (span?.[0] === lt && span[3]) {
      // Shadow-only stream markers also disappear when the host becomes text.
      const shadow: RawTextSpan[] = [];
      for (let at = spanIndex + 1; at < spans.length && spans[at][0] < span[1]; at++)
        appendRawTextSpans([spans[at]], shadow, -lt);
      htmlText(html.slice(lt, span[1]), shadow, 1);
      emit(htmlText(span[2], span[3], hidden));
      i = span[1];
      continue;
    }
    let ns: Namespace = stack.length > 0 ? stack[stack.length - 1][1] : 'html';
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      // These comments cannot remain DOM boundaries after text extraction.
      // The next shell pass renders those views inline before flushing.
      if (span?.[0] === lt && span[4] !== undefined && close !== -1) {
        const id = span[4];
        if (ctx?.streamingBoundaries?.has(id) || ctx?.inlineBoundaries?.has(id)) {
          if (hidden) (ctx.hiddenBoundaries ??= new Set()).add(id);
          else {
            ctx.inlineBoundaries?.add(id);
            (ctx.rawBoundaries ??= new Set()).add(id);
          }
        }
      }
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    // CDATA is character data in foreign content (a bogus comment in HTML).
    if (
      stack[stack.length - 1]?.[2] !== 'html' &&
      stack.length > 0 &&
      html.startsWith('<![CDATA[', lt)
    ) {
      const close = html.indexOf(']]>', lt + 9);
      const end = close === -1 ? html.length : close;
      emit(html.slice(lt + 9, end).replace(/\r\n?/g, '\n'), false);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    // Trusted callers can supply literal angle brackets in quoted attributes.
    let gt = lt + 1;
    let quote = '';
    for (; gt < html.length; gt++) {
      const c = html[gt];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (gt === html.length) break;
    i = gt + 1;
    const m = /^<(\/?)([a-z][^\s/>]*)/i.exec(html.slice(lt, gt + 1));
    if (!m) continue;
    const tag = m[2].toLowerCase();
    const close = m[1] === '/';
    const selfClosing = html[gt - 1] === '/';
    const attrs =
      tag === 'font' || tag === 'annotation-xml'
        ? htmlAttributes(html.slice(lt + m[0].length, gt))
        : undefined;
    const fontAttribute = !!attrs && (attrs.has('color') || attrs.has('face') || attrs.has('size'));
    if (
      ns !== 'html' &&
      (close ? tag === 'p' || tag === 'br' : foreignBreakout(tag, fontAttribute))
    ) {
      while (stack.length && stack[stack.length - 1][1] !== 'html') stack.pop();
      ns = 'html';
    }
    if (close) {
      // Pop up to the matching open element, if any.
      let at = stack.length - 1;
      while (at >= 0 && stack[at][0] !== tag) at--;
      if (at >= 0) stack.length = at;
      else if (tag === 'template' && ns === 'html') hidden = Math.max(hiddenBase, hidden - 1);
      continue;
    }
    if (selfClosing) continue;
    const parent = stack[stack.length - 1];
    const namespace = elementNamespace(ns, tag, parent?.[0], parent?.[2]);
    if (tag === 'template' && namespace === 'html') {
      hidden++;
      continue;
    }
    const encoding =
      namespace === 'math' && tag === 'annotation-xml' ? attrs?.get('encoding') : undefined;
    const inner = childNamespace(namespace, tag, encoding);
    if (namespace !== 'html' || !VOID_TAGS.has(tag)) {
      const body: TextGroup = [];
      const before: TextGroup | undefined =
        namespace === 'html' && tag === 'table' ? [] : undefined;
      const foster =
        ns === 'html' &&
        parent?.[2] === 'html' &&
        /^(?:table|tbody|tfoot|thead|tr)$/.test(parent[0]) &&
        !/^(?:caption|colgroup|col|tbody|tfoot|thead|tr|td|th|style|script)$/.test(tag)
          ? table()?.[4]
          : undefined;
      (foster ?? group()).push(before ? [before, body] : body);
      stack.push([tag, inner, namespace, body, before]);
    }
    if (namespace === 'html') {
      if (tag === 'plaintext') {
        emit(html.slice(i).replace(/\r\n?/g, '\n'), false);
        break;
      }
      // The parser drops one newline right after these start tags.
      dropLF = tag === 'textarea' || tag === 'pre' || tag === 'listing';
      // Raw text (as a scripting-enabled browser parses it) and RCDATA.
      if (/^(?:style|script|xmp|iframe|noembed|noframes|noscript|textarea|title)$/.test(tag)) {
        const end = rawEnd(html, i, tag);
        let text = html.slice(i, end).replace(/\r\n?/g, '\n');
        if (tag === 'textarea' || tag === 'title') text = decodeRefs(text);
        // Only generated spans have the original client text. Authored markup,
        // including literal CSS escapes, is read exactly as the browser reads it.
        else if (tag === 'style') {
          // The ordered cursor already points at this element's next span.
          if (span?.[0] === i && span[1] === end) text = span[2];
        }
        emit(text, false);
        i = end;
      }
    }
  }
  // Flatten once; neither repeated foster insertions nor deep trees repeatedly
  // copy already accumulated text.
  const chunks: string[] = [];
  const groups = [output];
  const positions = [0];
  while (groups.length) {
    const at = groups.length - 1;
    const item = groups[at][positions[at]++];
    if (item === undefined) {
      groups.pop();
      positions.pop();
    } else if (typeof item === 'string') chunks.push(item);
    else {
      groups.push(item);
      positions.push(0);
    }
  }
  return chunks.join('');
}

/**
 * Same coercion as valueToHtml for the content of a raw-text or RCDATA element,
 * where the HTML parser makes everything one text node: a nested template
 * contributes its text content, as it does on the client. For RCDATA
 * (`<textarea>`, `<title>`, `rcdata` set) the text is HTML-escaped. For
 * raw-text (`<style>`; dynamic `<script>` content is rejected) entities are not
 * decoded, so tag-opening `<` prefixes are written as the CSS escape `\3c `.
 * CSS comparison delimiters remain literal; top-level CDO tokens become CSS
 * comments, preserving their ignored-token semantics. The output cannot form a tag in
 * contexts such as raw text, foreign (SVG/MathML) content, or an ancestor
 * such as <xmp> or <noscript> that this element was nested in, including a
 * parent template it is spliced into at runtime. CSS reads `\3c ` as `<` in
 * strings and identifiers; textContent differs from the client until hydration.
 */
export function valueToRawText(
  parts: unknown[],
  rcdata?: unknown,
  spans?: RawTextSpan[],
  offset = 0,
): string {
  // Each part is one template slot (or static text): coerce them separately so
  // cycle tracking does not carry across slots, then escape the joined text.
  let text = '';
  for (let i = 0; i < parts.length; i++) text += valueToHtmlInner(parts[i], null, false);
  if (rcdata) return escHtml(text).replace(/\r/g, '&#13;');
  // An odd run of backslashes before `<` already escapes it in CSS (`\<` is
  // `<`): drop that backslash so the escape is not itself escaped.
  // Each prefix and adjacent slash run is visited once; an unanchored regex
  // would retry a long slash run at every starting position when no `<` follows.
  const chunks: string[] = [];
  const cdo = text.includes('<!--') ? cssCDO(text) : undefined;
  let start = 0;
  for (let end = text.indexOf('<'); end !== -1; end = text.indexOf('<', end + 1)) {
    // Only tag-opening prefixes can become markup when this fragment is
    // nested in another HTML context. CSS comparison operators must remain
    // delimiters: replacing `< 600px` with an escape turns it into an identifier.
    if (!/[A-Za-z/!?]/.test(text.charAt(end + 1))) continue;
    let slashes = 0;
    for (let i = end - 1; i >= start && text.charCodeAt(i) === 92; i--) slashes++;
    chunks.push(text.slice(start, end - (slashes % 2)), cdo?.has(end) ? '/**/' : '\\3c ');
    start = end + (cdo?.has(end) ? 4 : 1);
  }
  if (start === 0) {
    if (text.includes('\r')) spans?.push([offset, offset + text.length, text]);
    return text;
  }
  chunks.push(text.slice(start));
  const escaped = chunks.join('');
  spans?.push([offset, offset + escaped.length, text]);
  return escaped;
}

// `html` false: text mode for raw content (no escaping; nested SSR HTML
// becomes its text content).
function valueToHtmlInner(
  v: unknown,
  seen: WeakSet<object> | null,
  html: boolean,
  spans?: RawTextSpan[],
  offset = 0,
): string {
  if (typeof v === 'function') v = (v as () => unknown)();
  if (v == null || v === false) return '';
  const source = trustedHtml.get(v as object);
  if (source) {
    const markup = (v as SSRHtml).__purity_ssr_html__;
    if (!html) return htmlText(markup, source);
    if (spans) {
      appendRawTextSpans(source, spans, offset);
    }
    return markup;
  }
  if (Array.isArray(v)) {
    // Lazily allocate the visited set — non-cyclic input keeps the fast path
    // allocation-free; only arrays pay the WeakSet add cost.
    if (seen === null) seen = new WeakSet<object>();
    if (seen.has(v)) return '';
    seen.add(v);
    let s = '';
    for (let i = 0; i < v.length; i++) {
      s += valueToHtmlInner(v[i], seen, html, spans, offset + s.length);
    }
    return s;
  }
  const text = String(v);
  if (!html) return text;
  const escaped = escHtml(text);
  if (text.includes('\r')) spans?.push([offset, offset + escaped.length, text]);
  return escaped;
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
  slotSpans?: readonly RawTextSpan[],
  spans?: RawTextSpan[],
  offset?: number,
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
    throw new Error('A different renderer is already installed.');
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
function plainElement(
  tag: string,
  attrs: Record<string, unknown>,
  slotHtml: string,
  slotSpans?: readonly RawTextSpan[],
  spans?: RawTextSpan[],
  offset = 0,
): string {
  let s = `<${tag}`;
  for (const k of Object.keys(attrs)) {
    if (!SAFE_ATTR_NAME.test(k)) continue;
    const av = valueToAttr(attrs[k]);
    if (av !== null) s += av === '' ? ` ${k}` : ` ${k}="${av}"`;
  }
  // Custom elements are never void elements per the HTML spec — always emit
  // an explicit closing tag even if `slotHtml` is empty.
  if (spans && slotSpans) {
    appendRawTextSpans(slotSpans, spans, offset + s.length + 1);
  }
  return `${s}>${slotHtml}</${tag}>`;
}

/** Render a hyphenated element tag, dispatching to a registered component if any. */
export function ssrElement(
  tag: string,
  attrs: Record<string, unknown>,
  slotHtml: string,
  slotSpans?: readonly RawTextSpan[],
  spans?: RawTextSpan[],
  offset = 0,
): string {
  if (componentRenderer) {
    const result = componentRenderer(tag, attrs, slotHtml, slotSpans, spans, offset);
    if (result !== null) return result;
  }
  return plainElement(tag, attrs, slotHtml, slotSpans, spans, offset);
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
