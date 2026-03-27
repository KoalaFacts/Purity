import {
  type ComputedAccessor,
  compute,
  each,
  html,
  match,
  mount,
  onMount,
  type StateAccessor,
  state,
  watch,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

type Filter = 'all' | 'active' | 'done';

// ---------------------------------------------------------------------------
// TodoApp component
// ---------------------------------------------------------------------------

function TodoApp(): DocumentFragment {
  // --- State (fully typed) ---
  const todos: StateAccessor<Todo[]> = state<Todo[]>([]);
  const inputText: StateAccessor<string> = state('');
  const filter: StateAccessor<Filter> = state<Filter>('all');
  let nextId = 1;

  // --- Derived ---
  const filteredTodos: ComputedAccessor<Todo[]> = compute(() => {
    const f = filter();
    const list = todos();
    if (f === 'active') return list.filter((t) => !t.done);
    if (f === 'done') return list.filter((t) => t.done);
    return list;
  });

  const remaining: ComputedAccessor<number> = compute(() => todos().filter((t) => !t.done).length);

  const hasDone: ComputedAccessor<boolean> = compute(() => todos().some((t) => t.done));

  // --- Actions ---
  const addTodo = (): void => {
    const text = inputText().trim();
    if (!text) return;
    todos([...todos(), { id: nextId++, text, done: false }]);
    inputText('');
  };

  const toggleTodo = (id: number): void => {
    todos(todos().map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const deleteTodo = (id: number): void => {
    todos(todos().filter((t) => t.id !== id));
  };

  const clearDone = (): void => {
    todos(todos().filter((t) => !t.done));
  };

  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') addTodo();
  };

  const handleInput = (e: Event): void => {
    inputText((e.target as HTMLInputElement).value);
  };

  const setFilter = (f: Filter) => (): void => {
    filter(f);
  };

  // --- Lifecycle ---
  onMount(() => {
    console.log('Todo app mounted (TypeScript)');
    const saved = localStorage.getItem('purity-todos-ts');
    if (saved) {
      try {
        const parsed: Todo[] = JSON.parse(saved);
        todos(parsed);
        nextId = parsed.reduce((max, t) => Math.max(max, t.id + 1), 1);
      } catch {
        // ignore
      }
    }
  });

  watch(() => {
    const list = todos();
    localStorage.setItem('purity-todos-ts', JSON.stringify(list));
  });

  // --- View ---
  return html`
    <div class="app">
      <h1>Purity Todo</h1>
      <p class="subtitle">TypeScript demo of the Purity framework</p>

      <div class="input-row">
        <input
          type="text"
          placeholder="What needs to be done?"
          .value=${() => inputText()}
          @input=${handleInput}
          @keydown=${handleKeydown}
        />
        <button @click=${addTodo} ?disabled=${() => !inputText().trim()}>
          Add
        </button>
      </div>

      <div class="filters">
        <button
          class=${() => (filter() === 'all' ? 'active' : '')}
          @click=${setFilter('all')}
        >All</button>
        <button
          class=${() => (filter() === 'active' ? 'active' : '')}
          @click=${setFilter('active')}
        >Active</button>
        <button
          class=${() => (filter() === 'done' ? 'active' : '')}
          @click=${setFilter('done')}
        >Done</button>
      </div>

      ${match(() => filteredTodos().length === 0, {
        true: () => html`<p class="empty">No todos here yet.</p>`,
        false: () => html`
          <ul class="todo-list">
            ${each(
              filteredTodos,
              (todo: Todo) => html`
                <li class="todo-item">
                  <input
                    type="checkbox"
                    .checked=${todo.done}
                    @change=${() => toggleTodo(todo.id)}
                  />
                  <span class=${todo.done ? 'todo-text done' : 'todo-text'}>
                    ${todo.text}
                  </span>
                  <button class="delete-btn" @click=${() => deleteTodo(todo.id)}>
                    &times;
                  </button>
                </li>
              `,
              (todo: Todo) => todo.id,
            )}
          </ul>
        `,
      })}

      <div class="footer">
        <span>${() => remaining()} item${() => (remaining() === 1 ? '' : 's')} left</span>
        ${match(() => hasDone(), {
          true: () => html`<button class="clear-btn" @click=${clearDone}>Clear done</button>`,
        })}
      </div>
    </div>
  `;
}

mount(TodoApp, document.getElementById('app')!);
