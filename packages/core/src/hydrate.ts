// Root hydration is an explicit implementation boundary. CSR lifecycle does
// not import this module. Preparation reads serialization; success commits it.
import {
  enterHydration,
  exitHydration,
  inflateDeferred,
  isDeferred,
} from './compiler/hydrate-runtime.ts';
import { hydratePendingCustomElements } from './compiler/hydrate-elements.ts';
import {
  mount,
  scheduleMountCallbacks,
  unmountContext,
  type ComponentFn,
  type MountResult,
} from './component.ts';
import { ComponentContext, attachToOwner, pushContext, popContext } from './scope.ts';
import { checkpointHydrationCache, primeHydrationCache } from './ssr/hydration-cache.ts';

// A successful nested root supersedes an older cache checkpoint. No per-root
// script journal is needed because failed preparation did not mutate scripts.
let hydrationRevision = 0;

export function hydrate(container: Element, component: ComponentFn): MountResult {
  // Empty container — nothing to hydrate. Fall back to a fresh mount so
  // hydrate() works as a drop-in for mount() in dev/test setups that
  // skipped the SSR step. Checked before priming the resource cache: with
  // no SSR DOM there's nothing to adopt, and priming here would leak the
  // shell's cached values into a fresh render (and clobber another root's
  // module-level cache) as a side effect.
  if (!container.firstChild) {
    return mountHydrated(component, container);
  }

  // Resource values must be primed before the component creates subscriptions.
  // Preparation leaves serialization in place. A failure restores only the
  // resource read state; successful newer roots retain their own cache.
  const revision = hydrationRevision;
  const restoreCache = checkpointHydrationCache();
  const scripts = prepareResourceHydrationCache(container);
  const rollbackCache = (): void => {
    if (hydrationRevision === revision) restoreCache();
  };

  const ctx = new ComponentContext();
  attachToOwner(ctx, unmountContext);

  pushContext(ctx);
  enterHydration();

  let view: unknown;
  try {
    view = component();
  } catch (err) {
    exitHydration();
    popContext();
    // Report while error handlers and the parent are still available, then
    // release everything the abandoned render created, even on rethrow.
    // An error handler can unmount the parent while this child is attached.
    // Suppress the failed render's destroy lifecycle before dispatching it.
    ctx.destroyed = null;
    // A recovery handler may synchronously hydrate this same root. Release the
    // failed attempt's cache/scripts first and never attach recovery work to
    // the context that is about to be destroyed.
    try {
      rollbackCache();
      // _handleError normally binds recovery to the failing owner. Mark
      // it unavailable only during dispatch, so a nested hydrate can
      // outlive this failed render and its cleanup.
      ctx._isDestroyed = true;
      ctx._handleError(err);
    } finally {
      ctx._isDestroyed = false;
      unmountContext(ctx);
    }
    return { unmount: () => {} };
  }
  exitHydration();
  popContext();

  const deferred = isDeferred(view);
  if (deferred) {
    // Inflate in place. Moving SSR nodes through a fragment disconnects and
    // reconnects nested custom elements, tearing down their hydrated shadow
    // trees and rendering them a second time.
    try {
      inflateDeferred(view as Parameters<typeof inflateDeferred>[0], container);
    } catch (err) {
      // The walker hit a structural mismatch (cursor went off the rails on
      // null sibling / wrong nodeType). The opt-in mismatch warnings would
      // already have logged the divergence; here we recover by dropping the
      // SSR DOM and re-rendering fresh so the page keeps working.
      console.error('[Purity] Hydration walk failed; falling back to fresh mount:', err);
      // Tear down the abandoned context before re-rendering. The failed
      // render may have registered disposers (live watch/resource
      // subscriptions), onDestroy/onError handlers, and child contexts; left
      // orphaned they keep running and leak. unmountContext drains them and
      // removes ctx from parent.children itself. ctx.nodes is still null
      // (set only on the success path below), so no DOM is touched here.
      unmountContext(ctx);
      while (container.firstChild) container.removeChild(container.firstChild);
      return mountHydrated(component, container);
    }
  }

  // Existing direct children (including hydrated Custom Elements) and deferred
  // control-flow handles can reuse server DOM. Detached client-only AOT roots
  // cannot. Handle this rejection and a failing Custom Element hydration hook
  // with the same rollback, so neither can consume SSR scripts or leak owners.
  try {
    if (
      !deferred &&
      !(view instanceof Node && view.parentNode === container) &&
      !(
        view !== null &&
        typeof view === 'object' &&
        (view as { __purity_deferred_match__?: unknown }).__purity_deferred_match__ === true
      )
    ) {
      throw new Error('[Purity] hydrate() requires purity({ hydratable: true })');
    }
    hydratePendingCustomElements(container);
  } catch (err) {
    ctx.destroyed = null;
    try {
      rollbackCache();
    } finally {
      unmountContext(ctx);
    }
    throw err;
  }
  // Commit only after every adoption hook succeeded. Preparation never
  // removed these nodes, so rejection needs no DOM journal or reinsertion.
  for (let i = 0; i < scripts.length; i++) scripts[i]!.remove();
  ctx.nodes = Array.from(container.childNodes);
  hydrationRevision++;
  ctx._isMounted = true;

  scheduleMountCallbacks(ctx);

  return { unmount: () => unmountContext(ctx) };
}

function prepareResourceHydrationCache(container: Element): Element[] {
  // Collect only this root's serialization. In-root streamed chunks precede
  // its consecutive adjacent scripts; unrelated roots are never searched.
  const prefix = '__purity_resources_';
  // Nested SSR islands own their resource scripts. A parent shell must not
  // prime or consume a deferred island before its own hydration trigger.
  const ownerIsland = container.closest('purity-island');
  const inRoot = container.querySelectorAll(`script[id^="${prefix}"]`);
  const scripts: Element[] = [];
  for (let i = 0; i < inRoot.length; i++) {
    const script = inRoot[i]!;
    if (script.closest('purity-island') === ownerIsland) scripts.push(script);
  }
  let sibling = container.nextElementSibling;
  while (sibling?.tagName === 'SCRIPT') {
    if (sibling.id.startsWith(prefix)) scripts.push(sibling);
    sibling = sibling.nextElementSibling;
  }
  const shell = scripts.find((script) => script.id === '__purity_resources__');
  let merged: { ordered: unknown[]; keyed: Record<string, unknown> } | null = null;
  if (shell?.textContent != null) {
    try {
      merged = normalizeCachePayload(JSON.parse(shell.textContent));
    } catch (err) {
      console.error('[Purity] Failed to parse hydration cache:', err);
    }
  }
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]!;
    if (script === shell) continue;
    if (!merged) merged = { ordered: [], keyed: Object.create(null) };
    if (script.textContent == null) continue;
    try {
      const parsed = JSON.parse(script.textContent) as { keyed?: unknown };
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.keyed &&
        typeof parsed.keyed === 'object'
      ) {
        Object.assign(merged.keyed, parsed.keyed);
      }
    } catch (err) {
      console.error('[Purity] Failed to parse per-boundary hydration cache:', err);
    }
  }
  primeHydrationCache(merged ?? []);
  return scripts;
}

function normalizeCachePayload(parsed: unknown): {
  ordered: unknown[];
  keyed: Record<string, unknown>;
} {
  // Allocate one safe destination for legacy, current and invalid payloads.
  // Own JSON keys (including "__proto__") never hit inherited setters.
  const keyed: Record<string, unknown> = Object.create(null);
  let ordered: unknown[] = [];
  if (Array.isArray(parsed)) {
    ordered = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as { ordered?: unknown; keyed?: unknown };
    if (obj.keyed && typeof obj.keyed === 'object') Object.assign(keyed, obj.keyed);
    if (Array.isArray(obj.ordered)) ordered = obj.ordered;
  }
  return { ordered, keyed };
}

function mountHydrated(component: ComponentFn, container: Element): MountResult {
  let rendered = false;
  const result = mount(() => {
    const view = component();
    rendered = true;
    return view;
  }, container);
  if (rendered) hydrationRevision++;
  return result;
}
