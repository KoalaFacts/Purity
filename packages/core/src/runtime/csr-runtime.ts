// ---------------------------------------------------------------------------
// Purity CSR Template Runtime (`@purityjs/core/csr-runtime`)
//
// Lean DOM-only runtime helpers imported by client-first AOT templates
// (`purity()` default `hydratable: false`). Zero hydration walker, zero
// deferred-template machinery, zero SSR code.
// ---------------------------------------------------------------------------

/**
 * Shared lazy `<template>` cloner (`__purity_tmpl__`).
 *
 * Parses `html` into an `<HTMLTemplateElement>` on first render, runs optional
 * one-time comment-placeholder-to-Text conversion (`prep`), and caches either
 * the single root `Element` (`singleRoot === 1`, avoiding an outer
 * `DocumentFragment` wrapper allocation on every clone) or the template's
 * `DocumentFragment` (`content`).
 */
export function template(
  html: string,
  singleRoot?: 0 | 1,
  prep?: (content: DocumentFragment) => void,
): () => Node {
  let root: Node | undefined;
  return () => {
    if (!root) {
      const t = document.createElement('template');
      t.innerHTML = html;
      if (prep) prep(t.content);
      root = singleRoot ? t.content.firstChild! : t.content;
    }
    return root.cloneNode(true);
  };
}

/**
 * Shared URL protocol validator (`__purity_url__`) for URL-bearing attributes
 * (`href`, `src`, `action`, `formaction`, `poster`, etc.).
 * Coerces `v` to a string once so stateful `toString()` objects cannot swap to
 * an executable scheme (`javascript:`, `vbscript:`, non-raster `data:`) on a
 * second read.
 */
export function safeUrl(v: unknown): unknown {
  if (v == null || v === false) return v;
  if (v === true) return '';
  const s = String(v);
  // eslint-disable-next-line no-control-regex
  const p = s.replace(/[\u0000-\u0020\u007f]/g, '');
  if (
    /^(?:javascript|vbscript):/i.test(p) ||
    (/^data:/i.test(p) && !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,/i.test(p))
  ) {
    throw new Error('[Purity] Unsafe URL binding');
  }
  return s;
}

/**
 * Collect the leaf values of `v` into `out` (`__purity_fl__`), calling a
 * function item once and flattening arrays. `seen` is allocated on the first
 * array, so values without arrays stay allocation-free.
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

type Inflate = (deferred: never, target: Node, skipFirstNode: boolean, create: boolean) => unknown;

/**
 * Render a slot value (`__purity_sw__`) and return what the slot now holds.
 * `cur` is a Text node or the Node list a previous call returned.
 */
export function swapSlot(
  cur: ChildNode | ChildNode[],
  v: unknown,
  inflate?: Inflate,
): ChildNode | ChildNode[] {
  const leaves = Array.isArray(v) ? flattenValue(v, [], null) : v == null || v === false ? [] : [v];
  let text = '';
  let nodes = false;
  for (let i = 0; i < leaves.length; i++) {
    let y = leaves[i] as { __purity_deferred__?: boolean } | null;
    if (inflate && y != null && y.__purity_deferred__ === true) {
      const f = document.createDocumentFragment();
      inflate(y as never, f, false, true);
      leaves[i] = y = f as never;
    }
    if (y instanceof Node) nodes = true;
    else text += leaves[i] = String(y);
  }
  const next: ChildNode[] = [];
  if (!nodes) {
    if (!Array.isArray(cur) && cur.nodeType === 3) {
      (cur as Text).data = text;
      return cur;
    }
    next.push(document.createTextNode(text));
  } else {
    for (let i = 0; i < leaves.length; i++) {
      const y = leaves[i];
      if (!(y instanceof Node)) next.push(document.createTextNode(y as string));
      else if (y.nodeType === 11) for (let c = y.firstChild; c; c = c.nextSibling) next.push(c);
      else next.push(y as ChildNode);
    }
    if (next.length === 0) next.push(document.createTextNode(''));
  }
  const old = Array.isArray(cur) ? cur : [cur];
  const last = old[old.length - 1];
  const parent = last.parentNode;
  if (parent) {
    const anchor = last.nextSibling;
    const keep = new Set(next);
    for (let i = 0; i < old.length; i++) if (!keep.has(old[i])) old[i].remove();
    const f = document.createDocumentFragment();
    for (let i = 0; i < next.length; i++) f.appendChild(next[i]);
    parent.insertBefore(f, anchor);
  }
  return next.length === 1 ? next[0] : next;
}
