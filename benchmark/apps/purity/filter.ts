import { compute, each, html, state } from '@purity/core';

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
  const data = state<Item[]>([]);
  const query = state('');

  const filtered = compute(() => {
    const q = query().toLowerCase();
    if (!q) return data();
    return data().filter((item) => item.label.toLowerCase().includes(q));
  });

  const fragment = each(
    () => filtered(),
    (item: Item) => {
      const tr = html`
        <tr>
          <td class="col-md-1">${String(item.id)}</td>
          <td class="col-md-4"><a class="lbl">${item.label}</a></td>
        </tr>
      ` as unknown as HTMLTableRowElement;
      return tr;
    },
    (item: Item) => item.id,
  );
  tbody.appendChild(fragment);

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
  });

  populateBtn.addEventListener('click', () => {
    data(buildData(10000));
  });

  searchInput.addEventListener('input', () => {
    query(searchInput.value);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    query('');
  });
}
