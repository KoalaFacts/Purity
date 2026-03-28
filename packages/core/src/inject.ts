import { getCurrentContext } from './component.js';

// ---------------------------------------------------------------------------
// provide(key, value) / inject(key, fallback?) — dependency injection
// ---------------------------------------------------------------------------

const providerMap = new WeakMap<object, Map<string | symbol, unknown>>();
const injectCache = new WeakMap<object, Map<string | symbol, unknown>>();

export function provide<T>(key: string | symbol, value: T): void {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error(
      'provide() must be called inside a component() render function.\n' +
        '  Example: component("my-el", () => { provide("theme", state("dark")); ... })',
    );
  }

  let map = providerMap.get(ctx);
  if (!map) {
    map = new Map();
    providerMap.set(ctx, map);
  }
  map.set(key, value);
}

export function inject<T>(key: string | symbol): T;
export function inject<T>(key: string | symbol, fallback: T): T;
export function inject<T>(key: string | symbol, fallback?: T): T {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error(
      'inject() must be called inside a component() render function.\n' +
        '  Example: component("my-el", () => { const theme = inject("theme"); ... })',
    );
  }

  // Check cache first — avoid repeated tree walks
  let cache = injectCache.get(ctx);
  if (cache?.has(key)) {
    return cache.get(key) as T;
  }

  let current: object | null = ctx;
  while (current) {
    const map = providerMap.get(current);
    if (map?.has(key)) {
      const value = map.get(key) as T;
      if (!cache) {
        cache = new Map();
        injectCache.set(ctx, cache);
      }
      cache.set(key, value);
      return value;
    }
    current = (current as any).parent;
  }

  if (arguments.length >= 2) {
    return fallback as T;
  }

  throw new Error(
    `inject(): key "${String(key)}" not found.\n` +
      '  Did you forget to call provide() in a parent component?',
  );
}
