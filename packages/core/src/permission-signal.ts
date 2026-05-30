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
// the query resolves needs a per-call token so a STALE in-flight query
// resolving after the cache entry was evicted and re-created cannot
// attach a listener for the OLD status onto the NEW entry.
const listeners: Map<string, [EventTarget, () => void]> = new Map();
// Per-key generation token. Captured at query-start; the .then handler
// only attaches a listener if the token still matches `tokens.get(key)`
// at resolve time. Reset/eviction bumps the token, invalidating any
// in-flight query that started under the old generation.
const tokens: Map<string, object> = new Map();

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
  const accessor = compute(() => inner());
  // Cache optimistically so concurrent synchronous callers share one
  // in-flight query. On rejection we evict the entry so a later call
  // retries instead of being stuck against a stale accessor.
  cache.set(key, accessor);
  // Mint a fresh generation token for this query. Any in-flight query
  // that started under an earlier token (i.e. before a reset/evict +
  // re-create) is invalidated and will be a no-op on resolve.
  const token = {};
  tokens.set(key, token);
  // Wrap the query call itself in try/catch — a hostile/legacy browser
  // may throw synchronously on an unknown PermissionName instead of
  // returning a rejected promise. Without this, the throw escapes the
  // caller and we leak the optimistic cache entry.
  let pending: Promise<PermissionStatus>;
  try {
    pending = navigator.permissions.query({ name: key as PermissionName });
  } catch (err) {
    console.error('[purity] permissionSignal query threw for', key, err);
    if (cache.get(key) === accessor) cache.delete(key);
    if (tokens.get(key) === token) tokens.delete(key);
    return accessor;
  }
  pending
    .then((status) => {
      // Generation check: bail if this query is stale (reset() ran, or
      // the cache entry was evicted + re-created under a new token).
      if (tokens.get(key) !== token) return;
      inner(status.state);
      const onChange = (): void => {
        inner(status.state);
      };
      status.addEventListener('change', onChange);
      // Defensive: if somehow a previous listener for this key survived
      // (shouldn't happen under the token guard above, but cheap to be
      // safe), detach it before overwriting the entry.
      const prev = listeners.get(key);
      if (prev) prev[0].removeEventListener('change', prev[1]);
      listeners.set(key, [status, onChange]);
    })
    .catch((err) => {
      console.error('[purity] permissionSignal query failed for', key, err);
      // Only evict if the cache entry is still ours — a racing reset +
      // re-create may have already installed a fresh accessor.
      if (cache.get(key) === accessor) cache.delete(key);
      if (tokens.get(key) === token) tokens.delete(key);
    });
  return accessor;
}

/** @internal — test helper. Detaches every cached PermissionStatus
 * change listener and bumps the per-key generation token so any
 * in-flight query attaches nothing on resolve. */
export function _resetPermissionSignalCache(): void {
  for (const [status, onChange] of listeners.values()) {
    status.removeEventListener('change', onChange);
  }
  listeners.clear();
  cache.clear();
  // Drop all tokens — any in-flight `.then` will fail its
  // `tokens.get(key) !== token` guard and bail.
  tokens.clear();
}
