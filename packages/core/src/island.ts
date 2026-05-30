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
// Allow-list of literal trigger prefixes; `media:` accepts any suffix. Keeping
// this audit-local (rather than recomputing from the type) means a bad
// `options.hydrate` (e.g. from untrusted props JSON) can't slip a foreign
// data-pi-trigger attribute through escAttr into the wrapper.
//
// EXPORTED so the client-side `readTrigger` in `island-mount.ts` references
// the SAME set instance — Bug #14: if SSR and client validators drift the
// security boundary moves silently. Single source of truth eliminates that
// risk by construction.
export const ISLAND_TRIGGERS: ReadonlySet<string> = new Set([
  'load',
  'idle',
  'visible',
  'interact',
]);

function normalizeTrigger(raw: unknown): IslandTrigger {
  if (typeof raw !== 'string') return 'load';
  if (ISLAND_TRIGGERS.has(raw)) return raw as IslandTrigger;
  if (raw.startsWith('media:') && raw.length > 'media:'.length) return raw as IslandTrigger;
  return 'load';
}

export function island<V extends (...args: never[]) => unknown>(
  view: V,
  options: IslandOptions = {},
): V {
  // Guard against prototype-polluted / non-object options. Read `hydrate`
  // via `hasOwnProperty` so a malicious `Object.prototype.hydrate = ...`
  // can't poison every island in the page.
  const rawHydrate =
    options != null && typeof options === 'object'
      ? Object.prototype.hasOwnProperty.call(options, 'hydrate')
        ? (options as { hydrate?: unknown }).hydrate
        : undefined
      : undefined;
  const trigger: IslandTrigger = normalizeTrigger(rawHydrate);
  // Defining a fresh wrapper (rather than branding `view` directly) keeps
  // the user's view function untouched — `island(Counter)` doesn't mutate
  // `Counter`, so the same component can be used branded *and* unbranded.
  const wrapped = ((...args: Parameters<V>): ReturnType<V> | SSRHtml => {
    const ctx = getSSRRenderContext();
    if (ctx) {
      // SSR path — render the inner view to HTML and wrap it. The wrapper
      // is a valid HTMLElement (hyphen-cased custom-name → HTMLElement per
      // HTML spec) with `display:contents` so it doesn't affect layout.
      //
      // Throw isolation: allocate the ID BEFORE invoking `view`, but if
      // `view` throws we roll the counter back so subsequent islands keep
      // contiguous, stable IDs (essential for the position-based pairing
      // used by mountIslands). The error itself is rethrown unchanged —
      // higher-level boundaries (suspense, renderToString) decide policy.
      const id = ++ctx.islandCounter;
      let inner: string;
      try {
        inner = valueToHtml(view(...(args as never[])));
      } catch (err) {
        ctx.islandCounter = id - 1;
        throw err;
      }
      return markSSRHtml(
        `<purity-island data-pi-id="${id}" data-pi-trigger="${escAttr(trigger)}" ` +
          `style="display:contents">${inner}</purity-island>`,
      );
    }
    return view(...(args as never[])) as ReturnType<V>;
  }) as V;
  // Freeze the brand so user code can't mutate `trigger`/`view` after the
  // fact (which would silently break SSR-side data-pi-trigger emission or
  // the Vite plugin's static scan).
  const brand: IslandBrand<V> = Object.freeze({ view, trigger });
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
