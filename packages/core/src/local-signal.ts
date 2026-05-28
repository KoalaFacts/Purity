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

// storageKey -> set of subscribers listening for cross-tab updates
const registry: Map<string, Set<Registration>> = new Map();
let listenerInstalled = false;

function installListener(): void {
  if (listenerInstalled) return;
  if (typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === null) {
      // The whole storage was cleared — reset every registration.
      for (const set of registry.values()) {
        for (const apply of set) apply(null);
      }
      return;
    }
    const set = registry.get(e.key);
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

function parseStored<T>(
  raw: string,
  defaultValue: T,
  deserialize: (raw: string) => T,
  version: number,
  migrate: ((old: unknown, oldVersion: number) => T) | undefined,
): T {
  // Versioned envelope path.
  if (version > 0) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      // Not JSON at all — treat as legacy unversioned value.
      try {
        const legacy = deserialize(raw);
        return migrate ? migrate(legacy, 0) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    if (isEnvelope(envelope)) {
      if (envelope.__pv === version) {
        try {
          return deserialize(envelope.d);
        } catch {
          return defaultValue;
        }
      }
      if (migrate) {
        try {
          const old = deserialize(envelope.d);
          return migrate(old, envelope.__pv);
        } catch {
          try {
            return migrate(envelope.d, envelope.__pv);
          } catch {
            return defaultValue;
          }
        }
      }
      return defaultValue;
    }
    // No envelope wrapper — treat as legacy unversioned raw value.
    try {
      const legacy = deserialize(raw);
      return migrate ? migrate(legacy, 0) : defaultValue;
    } catch {
      return defaultValue;
    }
  }
  // Unversioned path — raw deserialize.
  try {
    return deserialize(raw);
  } catch {
    return defaultValue;
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
        // parseStored returns the post-migration value when version > 0
        // and the stored envelope version doesn't match.
        resolvedValue = parseStored(raw, defaultValue, deserialize, version, migrate);
        // If the stored envelope's version didn't match, the migrated
        // value hasn't been persisted yet — schedule a write-back below.
        if (version > 0) {
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
  let set = registry.get(key);
  if (!set) {
    set = new Set();
    registry.set(key, set);
  }
  const apply: Registration = (raw: string | null) => {
    if (raw === null) {
      // Key was removed or storage cleared — reset to default.
      inner(defaultValue);
      return;
    }
    inner(parseStored(raw, defaultValue, deserialize, version, migrate));
  };
  set.add(apply);

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
