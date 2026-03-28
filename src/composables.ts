// ---------------------------------------------------------------------------
// store(setup) — singleton store factory
//
//   const useTodos = store(() => {
//     const todos = state<Todo[]>([]);
//     const add = (text: string) => todos(v => [...v, { text, done: false }]);
//     return { todos, add };
//   });
//
//   const { todos, add } = useTodos(); // same instance everywhere
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
