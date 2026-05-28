// ---------------------------------------------------------------------------
// island(view, options) — opt-in per-subtree hydration boundary. ADR 0038,
// Phase 1.
//
// Phase 1 ships the brand mechanism only. `island(view)` returns a function
// that behaves identically to `view` on both SSR and client paths — same
// HTML out, same DOM out, same return value. The brand records `{ view,
// trigger }` so Phase 2's SSR runtime can emit a per-island bootstrap
// script next to the rendered region, and Phase 3's Vite plugin can split
// each island into its own client chunk.
//
// The brand is a non-enumerable symbol property on the wrapper function,
// not on the wrapper's return value. That lets the Vite plugin's static
// scan find islands at their call sites (`const X = island(Y)`) without
// having to invoke them, and lets the SSR runtime detect islands as they
// flow through expression slots without changing the result shape.
// ---------------------------------------------------------------------------

/**
 * When the island's chunk loads + hydrates. Phase 1 records the trigger
 * but does not act on it; Phase 2 implements `'load'` and `'visible'`,
 * Phase 4 fills in the rest.
 *
 * - `'load'`     — immediately after the chunk loads (default).
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
 * Mark a view function as an island — a hydration boundary that will (in
 * later phases) ship its own client chunk and hydrate on its own trigger.
 *
 * In Phase 1 this is a no-op brand: the wrapped view renders identically
 * to the unwrapped view. See ADR 0038 for the full design.
 *
 * @example
 * ```ts
 * const Counter = component('my-counter', () => { ... });
 * export const Interactive = island(Counter, { hydrate: 'visible' });
 * ```
 */
export function island<V extends (...args: never[]) => unknown>(
  view: V,
  options: IslandOptions = {},
): V {
  const trigger: IslandTrigger = options.hydrate ?? 'load';
  // Defining a fresh wrapper (rather than branding `view` directly) keeps
  // the user's view function untouched — `island(Counter)` doesn't mutate
  // `Counter`, so the same component can be used branded *and* unbranded.
  const wrapped = ((...args: Parameters<V>): ReturnType<V> =>
    view(...(args as never[])) as ReturnType<V>) as V;
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
 * value isn't branded. Used by the SSR runtime (Phase 2) and Vite plugin
 * (Phase 3); user code rarely needs this.
 */
export function getIslandBrand<V extends (...args: never[]) => unknown>(
  v: V,
): IslandBrand<V> | undefined {
  if (!isIsland(v)) return undefined;
  return (v as Branded<V>)[ISLAND_BRAND] as IslandBrand<V>;
}
