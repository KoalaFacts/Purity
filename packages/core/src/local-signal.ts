// ---------------------------------------------------------------------------
// localSignal(key, default, options?) — persisted, cross-tab-synced signal.
// ADR 0039.
//
// Server: returns a plain `state(defaultValue)`. No storage side-effects.
// Client: lazily reads from localStorage (or sessionStorage), keeps the
//         signal in sync with cross-tab writes via the `storage` event,
//         and writes back on every `.set()` / accessor call.
//
// One global `storage` listener fans out to every active signal keyed by
// its storage key. Quota errors during write log via console.error and
// don't throw — the in-memory state still updates.
// ---------------------------------------------------------------------------

import { getCurrentContext } from './component.ts';
import { state, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export interface LocalSignalOptions<T> {
  /** Which Storage to use. Defaults to `'local'`. */
  storage?: 'local' | 'session';
  /** Serializer. Defaults to `JSON.stringify`. */
  serialize?: (value: T) => string;
  /** Deserializer. Defaults to `JSON.parse`. */
  deserialize?: (raw: string) => T;
  /**
   * Stored-schema version. When `> 0`, values are wrapped in
   * `{ __pv, d }` envelopes so the version can be checked on read.
   * Bump this when the persisted shape changes.
   */
  version?: number;
  /**
   * Migration callback. Called once on read when the stored
   * envelope's version differs from `version`. Return the upgraded
   * value; the upgraded value is written back to storage.
   */
  migrate?: (old: unknown, oldVersion: number) => T;
}

type Registration = (raw: string | null) => void;

// Registry key is `${storageKind}:${key}` so a `local`-backed and a
// `session`-backed signal that happen to share the same key are isolated
// — a localStorage event won't bleed into a sessionStorage-backed signal
// and vice versa.
const registry: Map<string, Set<Registration>> = new Map();
let listenerInstalled = false;

function makeRegistryKey(kind: 'local' | 'session', key: string): string {
  return `${kind}:${key}`;
}

function installListener(): void {
  if (listenerInstalled) return;
  if (typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    // Storage events fire for BOTH localStorage and sessionStorage writes
    // (the latter same-tab same-origin). Route to the matching storage's
    // registrations only — without this filter, a localStorage event would
    // (incorrectly) also mutate sessionStorage-backed signals that happen
    // to share a key, and vice versa.
    //
    // Hardened: only act when `storageArea` is EXACTLY window.localStorage
    // or window.sessionStorage. Synthetic / dispatched events with a null
    // or unrecognised `storageArea` previously fell through to 'local',
    // letting any code on the page (or a cross-origin iframe synth event)
    // overwrite every local-backed signal. Now such events are ignored.
    let areaKind: 'local' | 'session';
    if (e.storageArea === window.localStorage) {
      areaKind = 'local';
    } else if (e.storageArea === window.sessionStorage) {
      areaKind = 'session';
    } else {
      return;
    }
    const prefix = `${areaKind}:`;
    if (e.key === null) {
      // Whole storage was cleared — reset every registration belonging to
      // that storage area only.
      for (const [k, set] of registry) {
        if (!k.startsWith(prefix)) continue;
        for (const apply of set) apply(null);
      }
      return;
    }
    const set = registry.get(prefix + e.key);
    if (!set) return;
    for (const apply of set) apply(e.newValue);
  });
}

function pickStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

type EnvelopeShape = { __pv: number; d: string };

function isEnvelope(v: unknown): v is EnvelopeShape {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { __pv?: unknown }).__pv === 'number' &&
    typeof (v as { d?: unknown }).d === 'string'
  );
}

// `succeeded: false` means "we fell back to defaultValue because the
// stored bytes were unreadable / unmigratable" — the caller MUST NOT
// then write defaultValue back to storage, or one buggy migrate
// function silently destroys user data across all their sessions /
// tabs. `succeeded: true` means the value reflects either a successful
// parse OR a successful migration; safe to persist.
interface ParseResult<T> {
  value: T;
  succeeded: boolean;
}

function parseStored<T>(
  raw: string,
  defaultValue: T,
  deserialize: (raw: string) => T,
  version: number,
  migrate: ((old: unknown, oldVersion: number) => T) | undefined,
): ParseResult<T> {
  const fallback: ParseResult<T> = { value: defaultValue, succeeded: false };
  // Versioned envelope path.
  if (version > 0) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      // Not JSON at all — treat as legacy unversioned value.
      try {
        const legacy = deserialize(raw);
        if (!migrate) return fallback;
        try {
          return { value: migrate(legacy, 0), succeeded: true };
        } catch {
          return fallback;
        }
      } catch {
        return fallback;
      }
    }
    if (isEnvelope(envelope)) {
      if (envelope.__pv === version) {
        try {
          return { value: deserialize(envelope.d), succeeded: true };
        } catch {
          return fallback;
        }
      }
      if (migrate) {
        try {
          const old = deserialize(envelope.d);
          return { value: migrate(old, envelope.__pv), succeeded: true };
        } catch {
          try {
            return { value: migrate(envelope.d, envelope.__pv), succeeded: true };
          } catch {
            return fallback;
          }
        }
      }
      return fallback;
    }
    // No envelope wrapper — treat as legacy unversioned raw value.
    try {
      const legacy = deserialize(raw);
      if (!migrate) return fallback;
      try {
        return { value: migrate(legacy, 0), succeeded: true };
      } catch {
        return fallback;
      }
    } catch {
      return fallback;
    }
  }
  // Unversioned path — raw deserialize.
  try {
    return { value: deserialize(raw), succeeded: true };
  } catch {
    return fallback;
  }
}

function encode<T>(value: T, serialize: (v: T) => string, version: number): string {
  const body = serialize(value);
  return version > 0 ? JSON.stringify({ __pv: version, d: body }) : body;
}

/**
 * Persisted, cross-tab-synced reactive state (ADR 0039).
 *
 * - **Server.** Returns a `state(defaultValue)` with no storage side-effects.
 * - **Client first read.** Lazily reads + deserializes from storage. When
 *   the stored envelope's `version` differs from `options.version`, calls
 *   `options.migrate(old, oldVersion)` (if provided) and writes the
 *   upgraded value back.
 * - **Client writes.** Update the signal, then write the serialized value
 *   to storage. Quota errors log via `console.error` and don't throw.
 * - **Cross-tab.** A single `window` `storage` listener fans out to every
 *   active `localSignal`; receiving a `storage` event updates the signal
 *   without echoing back to storage.
 *
 * @example
 * ```ts
 * const theme = localSignal('theme', 'light');
 * theme.set('dark');
 *
 * const cart = localSignal('cart', [] as CartItem[], {
 *   storage: 'session',
 *   version: 2,
 *   migrate: (old, oldVersion) => (oldVersion === 1 ? upgrade(old) : []),
 * });
 * ```
 */
export function localSignal<T>(
  key: string,
  defaultValue: T,
  options?: LocalSignalOptions<T>,
): StateAccessor<T> {
  // Server: no storage. Plain state.
  if (getSSRRenderContext() !== null) {
    return state(defaultValue);
  }
  if (typeof window === 'undefined') {
    return state(defaultValue);
  }
  const storageKind = options?.storage ?? 'local';
  const serialize = options?.serialize ?? (JSON.stringify as (v: T) => string);
  const deserialize = options?.deserialize ?? (JSON.parse as (s: string) => T);
  const version = options?.version ?? 0;
  const migrate = options?.migrate;
  const storage = pickStorage(storageKind);

  // Read the resolved value: either the parsed stored value (post-migrate
  // when versions differ) or the supplied default when storage is empty
  // or unreadable.
  let resolvedValue = defaultValue;
  let writeUpgrade = false;
  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        // parseStored returns { value, succeeded }. `succeeded: false`
        // means we fell back to defaultValue because the bytes were
        // unreadable / unmigratable — we MUST NOT then write that
        // default back, or a buggy migrate function silently destroys
        // the original data across every session and cross-tab listener.
        // Original bytes stay in storage so the developer can debug.
        const parsed = parseStored(raw, defaultValue, deserialize, version, migrate);
        resolvedValue = parsed.value;
        if (parsed.succeeded && version > 0) {
          try {
            const obj = JSON.parse(raw);
            if (!isEnvelope(obj) || obj.__pv !== version) writeUpgrade = true;
          } catch {
            writeUpgrade = true;
          }
        }
      }
    } catch {
      // localStorage access can throw (disabled, private mode). Fall back
      // to the default; in-memory behavior still works.
    }
  }

  const inner = state(resolvedValue);

  const writeToStorage = (value: T): void => {
    if (!storage) return;
    try {
      storage.setItem(key, encode(value, serialize, version));
    } catch (err) {
      console.error('[purity] localSignal failed to write', key, err);
    }
  };

  // Persist the post-migration value back so the next read sees the new
  // envelope version directly.
  if (writeUpgrade) writeToStorage(resolvedValue);

  // Register for cross-tab `storage` events.
  installListener();
  const registryKey = makeRegistryKey(storageKind, key);
  let set = registry.get(registryKey);
  if (!set) {
    set = new Set();
    registry.set(registryKey, set);
  }
  const apply: Registration = (raw: string | null) => {
    if (raw === null) {
      // Key was removed or storage cleared — reset to default.
      inner(defaultValue);
      return;
    }
    inner(parseStored(raw, defaultValue, deserialize, version, migrate).value);
  };
  set.add(apply);

  // Without this, every localSignal() call leaked one Registration (and
  // the state node it captures) into the registry for the page lifetime —
  // fine for module-scope usage, a real leak when called inside a
  // component / each() row that may unmount many times. Auto-register the
  // cleanup with the current component context, matching what watch() does.
  const ctx = getCurrentContext();
  if (ctx) {
    const dispose = (): void => {
      const s = registry.get(registryKey);
      if (!s) return;
      s.delete(apply);
      if (s.size === 0) registry.delete(registryKey);
    };
    (ctx.disposers ??= []).push(dispose);
  }

  const accessor = ((...args: [T | ((current: T) => T)] | []): T => {
    if (args.length === 0) return inner();
    const value = args[0];
    const next =
      typeof value === 'function' ? (value as (current: T) => T)(inner.peek()) : (value as T);
    inner(next);
    writeToStorage(next);
    return next;
  }) as StateAccessor<T>;
  (accessor as unknown as { get: () => T }).get = () => inner();
  (accessor as unknown as { set: (v: T) => void }).set = (v: T) => {
    inner(v);
    writeToStorage(v);
  };
  (accessor as unknown as { peek: () => T }).peek = () => inner.peek();
  return accessor;
}

/** @internal — test helper. Resets module-level state between tests. */
export function _resetLocalSignalRegistry(): void {
  registry.clear();
}

/** @internal — test helper. Returns the number of live registrations for a
 * given (storageKind, key) pair. Lets lifecycle tests verify that unmount
 * actually removes the apply from the registry. */
export function _localSignalRegistrySize(kind: 'local' | 'session', key: string): number {
  return registry.get(makeRegistryKey(kind, key))?.size ?? 0;
}
