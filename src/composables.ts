// ---------------------------------------------------------------------------
// Composables — reusable logic patterns
// ---------------------------------------------------------------------------

import type { ComputedAccessor, StateAccessor } from './signals.js';
import { compute } from './signals.js';

// ---------------------------------------------------------------------------
// useStore(setup) — singleton store factory
//
//   const useTodos = useStore(() => {
//     const todos = state<Todo[]>([]);
//     const add = (text: string) => todos(v => [...v, { text, done: false }]);
//     return { todos, add };
//   });
//
//   const { todos, add } = useTodos(); // same instance everywhere
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

// Re-export types for convenience
export type { ComputedAccessor, StateAccessor };
