// ---------------------------------------------------------------------------
// networkInformationSignal() — reactive `navigator.connection`. ADR 0042.
//
// Server: returns a constant default object.
// Client: lazy singleton. Reads navigator.connection (with vendor-prefixed
//         fallbacks), copies fields into a plain object on every `change`.
// ---------------------------------------------------------------------------

import { bindListeners } from './listen.ts';
import { compute, state, type ComputedAccessor } from '@purityjs/signals';
import { isSSR } from './ssr.ts';

export type NetworkInformation = {
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g';
  saveData: boolean;
  downlink: number;
  rtt: number;
  type: string;
};

type NetworkInformationLike = EventTarget & Partial<NetworkInformation>;
type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

const DEFAULT: NetworkInformation = {
  effectiveType: '4g',
  saveData: false,
  downlink: 10,
  rtt: 50,
  type: 'unknown',
};

let singleton: ComputedAccessor<NetworkInformation> | null = null;
// Detach for the `change` listener. Without it, _reset nulls the singleton
// but leaves the listener attached to navigator.connection.
let unbind: (() => void) | null = null;

function getConnection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  // The vendor-prefixed accessors are user-defined getters on some
  // browsers / proxies — defend against a throwing accessor instead of
  // bubbling the throw out to the caller.
  try {
    const nav = navigator as NavigatorWithConnection;
    return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
  } catch (err) {
    console.error('[purity] networkInformationSignal getConnection failed:', err);
    return null;
  }
}

const EFFECTIVE_TYPES = ['4g', '3g', '2g', 'slow-2g'] as const;

function narrowEffectiveType(v: unknown): NetworkInformation['effectiveType'] {
  return (EFFECTIVE_TYPES as readonly string[]).includes(v as string)
    ? (v as NetworkInformation['effectiveType'])
    : DEFAULT.effectiveType;
}

// Read one field defensively. A throwing getter on `navigator.connection`
// (hostile proxy, buggy browser) must not crash the whole snapshot — the
// field falls back to DEFAULT and siblings still update.
function safeRead<K extends keyof NetworkInformation>(
  c: NetworkInformationLike,
  key: K,
): NetworkInformation[K] | undefined {
  try {
    return c[key] as NetworkInformation[K] | undefined;
  } catch (err) {
    console.error(`[purity] networkInformationSignal ${String(key)} getter failed:`, err);
    return undefined;
  }
}

function snapshot(c: NetworkInformationLike): NetworkInformation {
  return {
    effectiveType: narrowEffectiveType(safeRead(c, 'effectiveType')),
    saveData: safeRead(c, 'saveData') ?? DEFAULT.saveData,
    downlink: safeRead(c, 'downlink') ?? DEFAULT.downlink,
    rtt: safeRead(c, 'rtt') ?? DEFAULT.rtt,
    type: safeRead(c, 'type') ?? DEFAULT.type,
  };
}

/**
 * Reactive `navigator.connection` (ADR 0042).
 *
 * - **Server.** Returns a constant
 *   `{ effectiveType: '4g', saveData: false, downlink: 10, rtt: 50, type: 'unknown' }`.
 * - **Client.** Lazy singleton; mirrors the NetworkInformation fields on
 *   every `change` event.
 * - **Unavailable browser.** Returns the SSR-default constant permanently
 *   (e.g. Safari / Firefox).
 */
export function networkInformationSignal(): ComputedAccessor<NetworkInformation> {
  if (isSSR()) {
    return compute(() => DEFAULT);
  }
  if (singleton) return singleton;
  const connection = getConnection();
  if (!connection) {
    singleton = compute(() => DEFAULT);
    return singleton;
  }
  const inner = state<NetworkInformation>(snapshot(connection));
  // A hostile EventTarget may throw from addEventListener; bindListeners
  // logs that and we keep a working (static) signal rather than crash.
  unbind = bindListeners(
    [[connection, 'change', () => inner(snapshot(connection))]],
    'networkInformationSignal',
  );
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Detaches the `change` listener so a fresh
 * call rebuilds from scratch without doubling up listeners on a cached
 * `navigator.connection`. */
export function _resetNetworkInformationSignal(): void {
  unbind?.();
  unbind = null;
  singleton = null;
}
