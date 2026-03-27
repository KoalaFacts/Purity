import type { ComputedAccessor, Dispose, StateAccessor } from './signals.js';
import { compute, state, watch } from './signals.js';

// ---------------------------------------------------------------------------
// useStore(setup) — define a composable store
//
//   const useTodos = useStore(() => {
//     const todos = state<Todo[]>([]);
//     const add = (text: string) => todos(v => [...v, { text, done: false }]);
//     const remaining = compute(() => todos().filter(t => !t.done).length);
//     return { todos, add, remaining };
//   });
//
//   // In a component:
//   const { todos, add, remaining } = useTodos();
// ---------------------------------------------------------------------------

export function useStore<T extends Record<string, unknown>>(setup: () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance) {
      instance = setup();
    }
    return instance;
  };
}

// ---------------------------------------------------------------------------
// useMemo(fn) — memoize a value, recompute only when deps change
//
//   const expensive = useMemo(() => heavyCalc(count()));
// ---------------------------------------------------------------------------

export const useMemo = compute;

// ---------------------------------------------------------------------------
// useRef(initial) — mutable ref that doesn't trigger reactivity
//
//   const el = useRef<HTMLElement | null>(null);
//   onMount(() => el.current.focus());
// ---------------------------------------------------------------------------

export interface Ref<T> {
  current: T;
}

export function useRef<T>(initial: T): Ref<T> {
  return { current: initial };
}

// ---------------------------------------------------------------------------
// useWatch — alias for watch, consistent with use* convention
// ---------------------------------------------------------------------------

export const useWatch = watch;

// Re-export types for convenience
export type { ComputedAccessor, Dispose, StateAccessor };
