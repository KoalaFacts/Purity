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

type SortMode = 'none' | 'id-asc' | 'id-desc' | 'label-asc';

export function createSortApp(
  tbody: HTMLElement,
  populateBtn: HTMLElement,
  sortIdBtn: HTMLElement,
  sortIdDescBtn: HTMLElement,
  sortLabelBtn: HTMLElement,
) {
  const data = state<Item[]>([]);
  const sortMode = state<SortMode>('none');

  const sorted = compute(() => {
    const s = data().slice();
    const mode = sortMode();
    if (mode === 'id-asc') s.sort((a, b) => a.id - b.id);
    else if (mode === 'id-desc') s.sort((a, b) => b.id - a.id);
    else if (mode === 'label-asc') s.sort((a, b) => a.label.localeCompare(b.label));
    return s;
  });

  const fragment = each(
    () => sorted(),
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
    data(buildData(1000));
    sortMode('none');
  });

  sortIdBtn.addEventListener('click', () => {
    sortMode('id-asc');
  });
  sortIdDescBtn.addEventListener('click', () => {
    sortMode('id-desc');
  });
  sortLabelBtn.addEventListener('click', () => {
    sortMode('label-asc');
  });
}
