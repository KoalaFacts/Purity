// Sort benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state } from '@purityjs/core';

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
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: mkLabel() };
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = state<Item[]>([]);
let sortOrder: 'id-asc' | 'id-desc' | 'label-asc' = 'id-asc';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function populate(count: number) {
  data(buildData(count));
  sortOrder = 'id-asc';
}

function sortByIdAsc() {
  if (sortOrder === 'id-asc') return;
  data(data.peek().slice().sort((a, b) => a.id - b.id));
  sortOrder = 'id-asc';
}

function sortByIdDesc() {
  const rows = data.peek();
  data(sortOrder === 'id-asc' ? rows.slice().reverse() : rows.slice().sort((a, b) => b.id - a.id));
  sortOrder = 'id-desc';
}

function sortByLabel() {
  if (sortOrder === 'label-asc') return;
  data(data.peek().slice().sort((a, b) => a.label.localeCompare(b.label)));
  sortOrder = 'label-asc';
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
      <div class="col-md-6"><h1>Purity (Sort)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="populate" @click=${() => populate(1000)}>Populate 1k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="sort-id" @click=${sortByIdAsc}>Sort by ID &#x2191;</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="sort-id-desc" @click=${sortByIdDesc}>Sort by ID &#x2193;</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="sort-label" @click=${sortByLabel}>Sort by Label &#x2191;</button>
        </div>
        ${hBtn('populate-100', 'Populate 100', () => populate(100))}
        ${hBtn('populate-10k', 'Populate 10k', () => populate(10000))}
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
  () => data(),
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
