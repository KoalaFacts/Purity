// ---------------------------------------------------------------------------
// __purity_swap — client-side splice helper for streamed Suspense boundaries.
//
// Inlined as a single `<script>` near the top of the streamed body by
// renderToStream(). Each resolved boundary chunk follows with a paired
// `<template id="purity-s-N">RESOLVED_HTML</template><script>__purity_swap(N)
// </script>` payload. The function locates the boundary's marker pair
// (<!--s:N-->...<!--/s:N-->), removes the fallback nodes between them, and
// inserts the template's content in place.
//
// Kept tiny — the whole helper is shipped in every streamed response and
// has to start executing before the boundary's HTML is parsed. Walks comment
// nodes only via TreeWalker (NodeFilter.SHOW_COMMENT = 0x80 = 128).
//
// Audit-v2 hardening:
//   - Rejects non-safe-integer ids before touching the DOM so malformed
//     ids can't construct surprise selectors like `purity-s-NaN` or match
//     unrelated `<!--s:NaN-->` markers.
//   - Bails out cleanly when `document.body` is missing (script can run
//     before body parse in mis-injected setups).
//   - Wraps DOM ops in try/catch + console.error so a single boundary's
//     failure doesn't bubble out of the inline `<script>` and pollute
//     unhandled-error logs / break the next chunk.
//
// The exported `PURITY_SWAP_SOURCE` string is what the SSR package writes
// inline; the runtime function is also exported so test harnesses (and
// non-streamed bundles that want to call it explicitly) can grab it.
// ADR 0006 Phase 3.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __purity_swap?: (n: number) => void;
  }
}

/**
 * Splice a streamed boundary's resolved HTML into place. Looks up the
 * `<template id="purity-s-N">` payload + the boundary's marker pair, removes
 * the fallback nodes between the markers, and inserts the template content
 * in their place. The template element is removed after the swap.
 *
 * Hardened against:
 *  - non-safe-integer / negative ids (bail before DOM touch),
 *  - missing `document.body` (TreeWalker would throw on a null root),
 *  - mid-splice exceptions (caught + console.error, never propagated).
 */
export function __purity_swap(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) return;
  const body = document.body;
  if (!body) return;
  const tpl = document.getElementById(`purity-s-${n}`) as HTMLTemplateElement | null;
  if (!tpl) return;
  try {
    const tw = document.createTreeWalker(body, 128 /* SHOW_COMMENT */);
    let open: Comment | null = null;
    let close: Comment | null = null;
    const openMatch = `s:${n}`;
    const closeMatch = `/s:${n}`;
    let node = tw.nextNode() as Comment | null;
    while (node) {
      if (node.data === openMatch) open = node;
      else if (node.data === closeMatch) {
        close = node;
        break;
      }
      node = tw.nextNode() as Comment | null;
    }
    if (!open || !close) return;
    const parent = close.parentNode;
    if (!parent) return;
    // Remove fallback nodes between open and close.
    let cur = open.nextSibling;
    while (cur && cur !== close) {
      const next = cur.nextSibling;
      parent.removeChild(cur);
      cur = next;
    }
    parent.insertBefore(tpl.content, close);
    tpl.remove();
  } catch (err) {
    console.error('[Purity] __purity_swap failed for boundary', n, err);
  }
}

/**
 * Source text of the swap helper, suitable for inlining in a `<script>` tag.
 * Compact, no template literals, no const/let — IIFE assigning to
 * `window.__purity_swap`. Mirrors the typed `__purity_swap` function above
 * 1:1 (audit-v2 hardening included); see the test file for the parity
 * assertions that keep the two in sync.
 *
 * Streaming responses inject this exactly once near the top of the body.
 */
export const PURITY_SWAP_SOURCE: string =
  'window.__purity_swap=function(n){' +
  'if(!Number.isSafeInteger(n)||n<0)return;' +
  'var d=document.body;if(!d)return;' +
  'var t=document.getElementById("purity-s-"+n);if(!t)return;' +
  'try{' +
  'var w=document.createTreeWalker(d,128),' +
  'o=null,c=null,a="s:"+n,b="/s:"+n,k=w.nextNode();' +
  'while(k){if(k.data===a)o=k;else if(k.data===b){c=k;break;}k=w.nextNode();}' +
  'if(!o||!c)return;var p=c.parentNode;if(!p)return;' +
  'var x=o.nextSibling;while(x&&x!==c){var y=x.nextSibling;p.removeChild(x);x=y;}' +
  'p.insertBefore(t.content,c);t.remove();' +
  '}catch(e){console.error("[Purity] __purity_swap failed for boundary",n,e);}' +
  '};';
