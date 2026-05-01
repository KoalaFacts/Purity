// Row rendering benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

const adjectives = [
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
const colours = [
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
const nouns = [
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

interface Row {
  id: number;
  label: string;
  tr?: HTMLTableRowElement;
  labelNode?: Text;
}

let nextId = 1;
let seed = 1;
const random = (max: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % max;
};
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): Row[] {
  const d = new Array<Row>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = state<Row[]>([]);
let selectedRow: HTMLTableRowElement | null = null;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function run(n: number) {
  data(buildData(n));
  selectedRow = null;
}

function add(n: number) {
  const current = data.peek();
  const added = buildData(n);
  const next = new Array<Row>(current.length + n);
  for (let i = 0; i < current.length; i++) next[i] = current[i];
  for (let i = 0; i < n; i++) next[current.length + i] = added[i];
  data(next);
}

function update() {
  const d = data();
  for (let i = 0; i < d.length; i += 10) {
    const item = d[i];
    item.label = `${item.label} !!!`;
    if (item.labelNode) item.labelNode.data = item.label;
  }
}

function clear() {
  data([]);
  selectedRow = null;
}

function swapRows() {
  data((d) => {
    if (d.length > 998) {
      const c = d.slice();
      const tmp = c[1];
      c[1] = c[998];
      c[998] = tmp;
      return c;
    }
    return d;
  });
}

function select(row: HTMLTableRowElement) {
  if (selectedRow) selectedRow.className = '';
  row.className = 'danger';
  selectedRow = row;
}

function remove(id: number) {
  data((d) => d.filter((item) => item.id !== id));
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
      <div class="col-md-6"><h1>Purity</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="run" @click=${() => run(1000)}>Create 1,000 rows</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="runlots" @click=${() => run(10000)}>Create 10,000 rows</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="add" @click=${() => add(1000)}>Append 1,000 rows</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update" @click=${update}>Update every 10th row</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="clear" @click=${clear}>Clear</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="swaprows" @click=${swapRows}>Swap Rows</button>
        </div>
        ${hBtn('run-10', 'Create 10', () => run(10))}
        ${hBtn('run-100', 'Create 100', () => run(100))}
        ${hBtn('run-1k', 'Create 1k', () => run(1000))}
        ${hBtn('run-10k', 'Create 10k', () => run(10000))}
        ${hBtn('add-10', 'Add 10', () => add(10))}
        ${hBtn('add-100', 'Add 100', () => add(100))}
        ${hBtn('add-1k', 'Add 1k', () => add(1000))}
        ${hBtn('add-10k', 'Add 10k', () => add(10000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const tbody = document.getElementById('tbody')!;

function RowView(item: Row): HTMLTableRowElement {
  const row = document.createElement('tr');
  item.tr = row;

  const id = document.createElement('td');
  id.className = 'col-md-1';
  id.textContent = String(item.id);
  row.appendChild(id);

  const label = document.createElement('td');
  label.className = 'col-md-4';
  const labelLink = document.createElement('a');
  labelLink.href = '#';
  labelLink.className = 'lbl';
  item.labelNode = document.createTextNode(item.label);
  labelLink.appendChild(item.labelNode);
  label.appendChild(labelLink);
  row.appendChild(label);

  const removeCell = document.createElement('td');
  removeCell.className = 'col-md-1';
  const removeLink = document.createElement('a');
  removeLink.href = '#';
  removeLink.className = 'remove';
  const icon = document.createElement('span');
  icon.className = 'remove glyphicon glyphicon-remove';
  icon.setAttribute('aria-hidden', 'true');
  removeLink.appendChild(icon);
  removeCell.appendChild(removeLink);
  row.appendChild(removeCell);

  const filler = document.createElement('td');
  filler.className = 'col-md-6';
  row.appendChild(filler);

  return row;
}

// Keyed list via each() — LIS reconciliation
const fragment = each(
  () => data(),
  (item: Row) => RowView(item),
  (item: Row) => item.id,
);
tbody.appendChild(fragment);

// Event delegation — one listener for all rows (standard benchmark pattern)
tbody.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const tr = a.closest('tr') as HTMLTableRowElement;
  if (a.classList.contains('lbl')) {
    select(tr);
    return;
  }
  if (selectedRow === tr) selectedRow = null;
  remove(+(tr.firstChild as HTMLElement).textContent!);
});

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
