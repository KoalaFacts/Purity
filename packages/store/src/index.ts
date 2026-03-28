// ---------------------------------------------------------------------------
// @purity/store — singleton store factory
//
//   import { store } from '@purity/store';
//
//   const useTodos = store(() => {
//     const todos = state<Todo[]>([]);
//     const add = (text: string) => todos(v => [...v, { text, done: false }]);
//     const remaining = compute(() => todos().filter(t => !t.done).length);
//     return { todos, add, remaining };
//   });
//
//   // Same instance everywhere
//   const { todos, add } = useTodos();
// ---------------------------------------------------------------------------

export function store<T extends Record<string, unknown>>(setup: () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance) {
      instance = setup();
    }
    return instance;
  };
}
