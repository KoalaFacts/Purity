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
  const inner = state<PermissionState>('prompt');
  navigator.permissions
    .query({ name: key as PermissionName })
    .then((status) => {
      inner(status.state);
      status.addEventListener('change', () => inner(status.state));
    })
    .catch((err) => {
      console.error('[purity] permissionSignal query failed for', key, err);
    });
  const accessor = compute(() => inner());
  cache.set(key, accessor);
  return accessor;
}

/** @internal — test helper. */
export function _resetPermissionSignalCache(): void {
  cache.clear();
}
