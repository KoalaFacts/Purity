// ---------------------------------------------------------------------------
// permissionSignal(name) — reactive Permissions API state. ADR 0042.
//
// Server: returns `compute(() => 'prompt')`.
// Client: caches per name. Initial 'prompt'; once
//         navigator.permissions.query({ name }) resolves, the signal mirrors
//         the PermissionStatus.state and listens for `change`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const cache: Map<string, ComputedAccessor<PermissionState>> = new Map();
// Track the resolved `PermissionStatus` + its change listener per name, so
// _reset can detach them. The async wire-up means a reset firing before
// the query resolves needs an abort flag to skip listener attach entirely.
const listeners: Map<string, [EventTarget, () => void]> = new Map();
const aborted: Set<string> = new Set();

/**
 * Reactive `navigator.permissions.query` state (ADR 0042).
 *
 * - **Server.** Returns a constant `'prompt'`.
 * - **Client.** Cached per `name`. Starts at `'prompt'`; the async
 *   `navigator.permissions.query({ name })` resolves into
 *   `'granted'` / `'denied'` / `'prompt'`. The signal then listens for
 *   `change` on the returned `PermissionStatus`.
 *
 * @example
 * ```ts
 * const cam = permissionSignal('camera');
 * when(() => cam() === 'granted', () => html`<live-camera/>`);
 * ```
 */
export function permissionSignal(
  name: PermissionDescriptor['name'] | string,
): ComputedAccessor<PermissionState> {
  if (
    getSSRRenderContext() !== null ||
    typeof navigator === 'undefined' ||
    !navigator.permissions ||
    typeof navigator.permissions.query !== 'function'
  ) {
    return compute(() => 'prompt' as PermissionState);
  }
  const key = String(name);
  const existing = cache.get(key);
  if (existing) return existing;
  aborted.delete(key);
  const inner = state<PermissionState>('prompt');
  const accessor = compute(() => inner());
  // Cache optimistically so concurrent synchronous callers share one
  // in-flight query. On rejection we evict the entry so a later call
  // retries instead of being stuck against a stale accessor.
  cache.set(key, accessor);
  navigator.permissions
    .query({ name: key as PermissionName })
    .then((status) => {
      if (aborted.has(key)) return;
      inner(status.state);
      const onChange = (): void => {
        inner(status.state);
      };
      status.addEventListener('change', onChange);
      listeners.set(key, [status, onChange]);
    })
    .catch((err) => {
      console.error('[purity] permissionSignal query failed for', key, err);
      if (cache.get(key) === accessor) cache.delete(key);
    });
  return accessor;
}

/** @internal — test helper. Detaches every cached PermissionStatus
 * change listener and arms abort flags so any in-flight query attaches
 * nothing on resolve. */
export function _resetPermissionSignalCache(): void {
  for (const key of cache.keys()) aborted.add(key);
  for (const [status, onChange] of listeners.values()) {
    status.removeEventListener('change', onChange);
  }
  listeners.clear();
  cache.clear();
}
