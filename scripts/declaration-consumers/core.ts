// Consumer of the built `@purityjs/core` declarations (SV2-014).
import { asyncCompute, isPending } from '@purityjs/core/async';
import { type StoreView, store } from '@purityjs/core/store';
import {
  type ResourceAccessor,
  type SlotAccessor,
  component,
  each,
  resource,
  slot,
  state,
} from '@purityjs/core';

// component(): typed props and slots.
const Greeting = component<{ name: string; count?: number }, { footer: void; row: { id: number } }>(
  'x-greeting',
  (props, slots) => {
    const name: string = props.name;
    const count: number | undefined = props.count;
    const footer: Node | null = slots.footer();
    const row: Node | null = slots.row({ id: 1 });
    // @ts-expect-error props are typed
    const wrong: number = props.name;
    // @ts-expect-error unknown props are rejected
    void props.missing;
    // @ts-expect-error an exposed slot needs its argument
    slots.row();
    // @ts-expect-error exposed slot arguments are typed
    slots.row({ id: 'one' });
    void [name, count, footer, row, wrong];
    return document.createElement('div');
  },
);
Greeting({ name: 'Ada' });
Greeting({ name: 'Ada', count: 2 });
// @ts-expect-error a required prop is required
Greeting({});
// @ts-expect-error prop types are enforced at the call site
Greeting({ name: 1 });

const plain: SlotAccessor = slot();
const exposed: SlotAccessor<{ open: boolean }> = slot<{ open: boolean }>('item');
exposed({ open: true });
// @ts-expect-error a plain slot takes no argument
plain({ open: true });

// resource(): fetcher-only and source-keyed overloads.
const user: ResourceAccessor<{ id: number }> = resource(async () => ({ id: 1 }));
const id = state<number | null>(1);
const byId = resource(id, async (key, info) => {
  const n: number = key;
  const signal: AbortSignal = info.signal;
  void signal;
  return { id: n };
});
const current: { id: number } | undefined = byId();
const loading: boolean = byId.loading();
user.mutate({ id: 2 });
user.mutate((prev) => ({ id: (prev?.id ?? 0) + 1 }));
// @ts-expect-error a resource value may be undefined before it resolves
const eager: { id: number } = user();
// @ts-expect-error mutate() keeps the resource type
user.mutate({ id: '2' });
// @ts-expect-error the source key is non-nullable inside the fetcher
resource(id, async (key: null) => key);

// each(): item and key types flow from the list.
const rows = state([{ id: 1, label: 'a' }]);
each(
  rows,
  (row) => {
    const label: string = row().label;
    return label;
  },
  (row) => row.id,
);
each(rows, (row) => {
  // @ts-expect-error row accessors keep the item type
  const n: number = row().label;
  return String(n);
});

// asyncCompute() and store() from their opt-in entries.
const total = asyncCompute(async () => 42);
try {
  const value: number = total();
  void value;
} catch (err) {
  const pending: boolean = isPending(err);
  void pending;
}
// @ts-expect-error async results unwrap the promise
const asString: string = total();

const [view, update] = store({ todos: [{ done: false, text: 'a' }] });
const done: boolean = view.todos[0]!.done;
update((draft) => {
  draft.todos.push({ done: true, text: 'b' });
});
const typedView: StoreView<{ todos: { done: boolean; text: string }[] }> = view;
// @ts-expect-error store views are read-only
view.todos[0]!.done = true;
update((draft) => {
  // @ts-expect-error the draft keeps the store's shape
  draft.todos.push({ done: 'yes' });
});

void [current, loading, eager, asString, done, typedView];
