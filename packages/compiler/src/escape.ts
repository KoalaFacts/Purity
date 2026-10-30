// ---------------------------------------------------------------------------
// Purity Compiler — HTML Escaping & Lexical Namespace Helpers
//
// Pure HTML5 lexical helpers shared between @purityjs/compiler (template
// parser and static/SSR codegen) and @purityjs/ssr (runtime serialization and
// text extraction). Zero DOM or Node dependencies.
// ---------------------------------------------------------------------------

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

/** Namespace an element's children are parsed in. */
export type Namespace = 'html' | 'svg' | 'math';

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
