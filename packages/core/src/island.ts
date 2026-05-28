// ---------------------------------------------------------------------------
// island(view, options) — opt-in per-subtree hydration boundary. ADR 0038.
//
// Phase 1 shipped the brand mechanism only; Phase 2 adds the SSR wrapper.
// When called inside an SSR context, the wrapper now emits the island's
// rendered HTML inside `<purity-island data-pi-id="N" data-pi-trigger="…"
// style="display:contents">…</purity-island>` so the client-side
// `mountIslands()` runtime can locate each island and hydrate it on its
// configured trigger. On the client, `island(view)()` is still a direct
// passthrough to `view()` — there is no client-side island runtime cost
// unless the user opts in by calling `mountIslands(...)`.
//
// The wrapper element name is hyphen-cased so it parses as a valid
// HTMLElement (HTML treats unknown custom-name elements as `HTMLElement`).
// `display:contents` keeps the wrapper layout-transparent so users don't
// have to add a CSS rule to undo a stray block-vs-inline default.
//
// The brand is a non-enumerable symbol property on the wrapper function,
// not on its return value. That lets the Vite plugin's static scan in
// Phase 3 find islands at their call sites (`const X = island(Y)`)
// without invoking them, and lets the SSR runtime detect islands as they
// flow through expression slots without changing the result shape.
// ---------------------------------------------------------------------------

import { escAttr, markSSRHtml, type SSRHtml, valueToHtml } from './compiler/ssr-runtime.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * When the island's chunk loads + hydrates. Phase 2 implements `'load'`
 * and `'visible'` in {@link mountIslands}; Phase 4 fills in `'idle'`,
 * `'interact'`, and `media:…`.
 *
 * - `'load'`     — immediately on the next microtask (default).
 * - `'idle'`     — inside `requestIdleCallback`.
 * - `'visible'`  — when the island's root enters the viewport.
 * - `'interact'` — on first pointerdown / focusin / keydown inside the root.
 * - `media:(…)`  — when the given media query matches.
 */
export type IslandTrigger = 'load' | 'idle' | 'visible' | 'interact' | `media:${string}`;

export interface IslandOptions {
  /** When the island hydrates. Defaults to `'load'`. */
  hydrate?: IslandTrigger;
}

/**
 * Brand attached to island view functions. Opaque to user code — read via
 * {@link getIslandBrand}, test for via {@link isIsland}.
 */
export interface IslandBrand<
  V extends (...args: never[]) => unknown = (...args: never[]) => unknown,
> {
  readonly view: V;
  readonly trigger: IslandTrigger;
}

// Local symbol — not `Symbol.for(...)` — so the brand is genuinely
// opaque: unrelated modules can't fish for it by string key.
const ISLAND_BRAND: unique symbol = Symbol('purity.island');

type Branded<V extends (...args: never[]) => unknown> = V & {
  readonly [ISLAND_BRAND]: IslandBrand<V>;
};

/**
 * Mark a view function as an island — a hydration boundary that ships
 * with its own per-trigger bootstrap on the server and (in Phase 3) its
 * own client chunk.
 *
 * @example
 * ```ts
 * const Counter = component('my-counter', () => { ... });
 * export const Interactive = island(Counter, { hydrate: 'visible' });
 * ```
 *
 * @remarks
 * Two islands on the same page have independent signal graphs. Shared
 * state belongs in the URL, in `persist()`-style storage, or behind a
 * server round-trip — closures over module-scope state will be
 * duplicated when each island ships in its own chunk (Phase 3).
 */
export function island<V extends (...args: never[]) => unknown>(
  view: V,
  options: IslandOptions = {},
): V {
  const trigger: IslandTrigger = options.hydrate ?? 'load';
  // Defining a fresh wrapper (rather than branding `view` directly) keeps
  // the user's view function untouched — `island(Counter)` doesn't mutate
  // `Counter`, so the same component can be used branded *and* unbranded.
  const wrapped = ((...args: Parameters<V>): ReturnType<V> | SSRHtml => {
    const ctx = getSSRRenderContext();
    if (ctx) {
      // SSR path — render the inner view to HTML and wrap it. The wrapper
      // is a valid HTMLElement (hyphen-cased custom-name → HTMLElement per
      // HTML spec) with `display:contents` so it doesn't affect layout.
      const id = ++ctx.islandCounter;
      const inner = valueToHtml(view(...(args as never[])));
      return markSSRHtml(
        `<purity-island data-pi-id="${id}" data-pi-trigger="${escAttr(trigger)}" ` +
          `style="display:contents">${inner}</purity-island>`,
      );
    }
    return view(...(args as never[])) as ReturnType<V>;
  }) as V;
  const brand: IslandBrand<V> = { view, trigger };
  Object.defineProperty(wrapped, ISLAND_BRAND, {
    value: brand,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return wrapped;
}

/** Type guard: `true` iff `v` is a view function branded by {@link island}. */
export function isIsland(v: unknown): v is Branded<(...args: never[]) => unknown> {
  return typeof v === 'function' && Object.prototype.hasOwnProperty.call(v, ISLAND_BRAND);
}

/**
 * Read the island brand from a view function. Returns `undefined` if the
 * value isn't branded. Used by the SSR runtime and the Vite plugin (Phase
 * 3); user code rarely needs this.
 */
export function getIslandBrand<V extends (...args: never[]) => unknown>(
  v: V,
): IslandBrand<V> | undefined {
  if (!isIsland(v)) return undefined;
  return (v as Branded<V>)[ISLAND_BRAND] as IslandBrand<V>;
}
