import { createMemo, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

const A = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
];
const C = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
];
const N = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

interface Item {
  id: number;
  label: string;
}

let nextId = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

function buildData(count: number): Item[] {
  const d = new Array<Item>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: mkLabel() };
  return d;
}

export function createFilterApp(
  tbody: HTMLElement,
  searchInput: HTMLInputElement,
  populateBtn: HTMLElement,
  clearSearchBtn: HTMLElement,
) {
  const [data, setData] = createSignal<Item[]>([]);
  const [query, setQuery] = createSignal('');

  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    if (!q) return data();
    return data().filter((item) => item.label.toLowerCase().includes(q));
  });

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
  });

  populateBtn.addEventListener('click', () => {
    setData(buildData(10000));
  });

  searchInput.addEventListener('input', () => {
    setQuery(searchInput.value);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    setQuery('');
  });

  render(
    () => (
      <For each={filtered()}>
        {(item: Item) => (
          <tr>
            <td class="col-md-1">{item.id}</td>
            <td class="col-md-4">
              <a class="lbl">{item.label}</a>
            </td>
          </tr>
        )}
      </For>
    ),
    tbody,
  );
}
