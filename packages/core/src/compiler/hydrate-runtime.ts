// ---------------------------------------------------------------------------
// Hydration runtime — deferred-template thunks + mode flag.
//
// During `hydrate()`, the `html\`\`` tag returns a DeferredTemplate object
// instead of building DOM. This lets the hydrator inflate each template
// against the slice of SSR DOM it owns — including templates nested inside
// expression slots (`html\`<p>${html\`<span>${name}</span>\`}</p>\``), which
// evaluate eagerly in JS and would otherwise build fresh DOM before the
// outer factory ever sees the SSR root.
//
// The mode is a module-scoped boolean (single-threaded JS, single hydrate
// pass at a time). `enterHydration` / `exitHydration` toggle it; the
// compiled hydrate factories are JIT-cached alongside the client factories.
// ---------------------------------------------------------------------------

/** A reified `html\`\`` call captured during hydration; inflated against an SSR subtree. */
export interface DeferredTemplate {
  __purity_deferred__: true;
  strings: TemplateStringsArray;
  values: unknown[];
}

let hydrating = 0;

/** True while a `hydrate()` (or DSD-aware Custom Element) call is in progress. */
export function isHydrating(): boolean {
  return hydrating > 0;
}

/** Enter hydration mode. Refcounted so nested calls compose correctly. */
export function enterHydration(): void {
  hydrating++;
}

/** Exit hydration mode. */
export function exitHydration(): void {
  if (hydrating > 0) hydrating--;
}

export function isDeferred(v: unknown): v is DeferredTemplate {
  return (
    v != null &&
    typeof v === 'object' &&
    (v as { __purity_deferred__?: unknown }).__purity_deferred__ === true
  );
}

export function makeDeferred(strings: TemplateStringsArray, values: unknown[]): DeferredTemplate {
  return { __purity_deferred__: true, strings, values };
}
