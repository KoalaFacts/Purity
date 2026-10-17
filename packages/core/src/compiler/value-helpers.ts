// ---------------------------------------------------------------------------
// Client-side value coercion shared by every generated binding site (CSR and
// hydrate). Generated code receives these as the free names `__purity_fl__` /
// `__purity_sw__` (flattenValue / swapSlot): compile.ts binds them for JIT
// factories, and the AOT plugin imports them into compiled modules. Keeping
// them here (instead of inlining them per template) means each template pays
// only for the call sites it uses.
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

type Inflate = (deferred: never, target: Node, skipFirstNode: boolean, create: boolean) => unknown;

/**
 * Render a slot value (`__purity_sw__`) and return what the slot now holds.
 * `cur` is a Text node or the Node list a previous call returned. A value
 * without Nodes renders as text into one Text node, kept when `cur` is one; a
 * Node or an array with a Node replaces the slot's nodes, a fragment
 * contributing its children. The value itself is not called: the binding has
 * called the accessor once, and SSR does not call the result. `inflate`
 * (hydration) builds templates captured as deferred.
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
    // Coerce once: a stateful toString must not run again when rendering.
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
    // An empty slot keeps a Text node as its position in the DOM.
    if (next.length === 0) next.push(document.createTextNode(''));
  }
  const old = Array.isArray(cur) ? cur : [cur];
  const last = old[old.length - 1];
  const parent = last.parentNode;
  if (parent) {
    // Remove the replaced nodes before inserting their successors, so custom
    // elements disconnect before the new ones connect.
    const anchor = last.nextSibling;
    const keep = new Set(next);
    for (let i = 0; i < old.length; i++) if (!keep.has(old[i])) old[i].remove();
    const f = document.createDocumentFragment();
    for (let i = 0; i < next.length; i++) f.appendChild(next[i]);
    parent.insertBefore(f, anchor);
  }
  return next.length === 1 ? next[0] : next;
}
