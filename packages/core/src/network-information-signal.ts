// ---------------------------------------------------------------------------
// networkInformationSignal() — reactive `navigator.connection`. ADR 0042.
//
// Server: returns a constant default object.
// Client: lazy singleton. Reads navigator.connection (with vendor-prefixed
//         fallbacks), copies fields into a plain object on every `change`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

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
// (connection, listener) so reset can detach. Without this, _reset nulls
// the singleton but leaves the listener attached to navigator.connection.
let boundConnection: EventTarget | null = null;
let boundListener: (() => void) | null = null;

function getConnection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as NavigatorWithConnection;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

const EFFECTIVE_TYPES = ['4g', '3g', '2g', 'slow-2g'] as const;

function narrowEffectiveType(v: unknown): NetworkInformation['effectiveType'] {
  return (EFFECTIVE_TYPES as readonly string[]).includes(v as string)
    ? (v as NetworkInformation['effectiveType'])
    : DEFAULT.effectiveType;
}

function snapshot(c: NetworkInformationLike): NetworkInformation {
  return {
    effectiveType: narrowEffectiveType(c.effectiveType),
    saveData: c.saveData ?? DEFAULT.saveData,
    downlink: c.downlink ?? DEFAULT.downlink,
    rtt: c.rtt ?? DEFAULT.rtt,
    type: c.type ?? DEFAULT.type,
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
  if (getSSRRenderContext() !== null) {
    return compute(() => DEFAULT);
  }
  if (singleton) return singleton;
  const connection = getConnection();
  if (!connection) {
    singleton = compute(() => DEFAULT);
    return singleton;
  }
  const inner = state<NetworkInformation>(snapshot(connection));
  const onChange = (): void => {
    inner(snapshot(connection));
  };
  connection.addEventListener('change', onChange);
  boundConnection = connection;
  boundListener = onChange;
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Detaches the `change` listener so a fresh
 * call rebuilds from scratch without doubling up listeners on a cached
 * `navigator.connection`. */
export function _resetNetworkInformationSignal(): void {
  if (boundConnection && boundListener) {
    boundConnection.removeEventListener('change', boundListener);
  }
  boundConnection = null;
  boundListener = null;
  singleton = null;
}
