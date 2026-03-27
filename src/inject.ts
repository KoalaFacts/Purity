import { getCurrentContext } from './component.js';

// ---------------------------------------------------------------------------
// provide(key, value) / inject(key, fallback?) — dependency injection
//
// Parent provides:
//   provide('theme', state('dark'));
//
// Child injects:
//   const theme = inject<StateAccessor<string>>('theme');
//   theme()  // 'dark'
// ---------------------------------------------------------------------------

const providerMap = new WeakMap<object, Map<string | symbol, unknown>>();

export function provide<T>(key: string | symbol, value: T): void {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error('provide() must be called inside a component');
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
    throw new Error('inject() must be called inside a component');
  }

  // Walk up the context tree to find the provider
  let current: object | null = ctx;
  while (current) {
    const map = providerMap.get(current);
    if (map?.has(key)) {
      return map.get(key) as T;
    }
    current = (current as any).parent;
  }

  // Not found — use fallback or throw
  if (arguments.length >= 2) {
    return fallback as T;
  }

  throw new Error(`inject(): key "${String(key)}" not provided`);
}
