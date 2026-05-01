// Filter benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

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
  lowerLabel: string;
}

let nextId = 1;
let seed = 1;
const rnd = (m: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % m;
};
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

function buildData(count: number): Item[] {
  const d = new Array<Item>(count);
  for (let i = 0; i < count; i++) {
    const label = mkLabel();
    d[i] = { id: nextId++, label, lowerLabel: label.toLowerCase() };
  }
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = state<Item[]>([]);
const query = state('');

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const filtered = compute(() => {
  const q = query().toLowerCase();
  if (!q) return data();
  return data().filter((item) => item.lowerLabel.includes(q));
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function populate(count: number) {
  data(buildData(count));
}

function clearSearch() {
  const input = document.getElementById('search') as HTMLInputElement | null;
  if (input) input.value = '';
  query('');
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Filter)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <input type="text" id="search" placeholder="Search..." class="form-control" @input=${(e: InputEvent) => query((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="populate" @click=${() => populate(10000)}>Populate 10k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="clear-search" @click=${clearSearch}>Clear Search</button>
        </div>
        ${hBtn('populate-10', 'Populate 10', () => populate(10))}
        ${hBtn('populate-100', 'Populate 100', () => populate(100))}
        ${hBtn('populate-1k', 'Populate 1k', () => populate(1000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const tbody = document.getElementById('tbody')!;

function RowView(item: Item): HTMLTableRowElement {
  const row = document.createElement('tr');

  const id = document.createElement('td');
  id.className = 'col-md-1';
  id.textContent = String(item.id);
  row.appendChild(id);

  const label = document.createElement('td');
  label.className = 'col-md-4';
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'lbl';
  link.textContent = item.label;
  label.appendChild(link);
  row.appendChild(label);

  return row;
}

const fragment = each(
  () => filtered(),
  (item: Item) => RowView(item),
  (item: Item) => item.id,
);
tbody.appendChild(fragment);

// Event delegation — prevents default on label clicks
tbody.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
