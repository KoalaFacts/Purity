// ---------------------------------------------------------------------------
// Purity js-framework-benchmark — FAIR keyed implementation
//
// Uses Purity state() + watch() for all reactivity.
// Proper keyed reconciliation — no full DOM rebuild on each update.
// ---------------------------------------------------------------------------

import { state, watch } from '../../packages/core/src/index.ts';

// ---------------------------------------------------------------------------
// Data
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

interface RowItem {
  id: number;
  label: string;
}

interface CachedRow {
  tr: HTMLTableRowElement;
  labelNode: Text;
  label: string;
}

let nextId = 1;
const random = (max: number) => (Math.random() * max) | 0;
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): RowItem[] {
  const d = new Array<RowItem>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

// ---------------------------------------------------------------------------
// Purity signals
// ---------------------------------------------------------------------------

const data = state<RowItem[]>([]);
const selectedId = state(0);

// ---------------------------------------------------------------------------
// Row cache — keyed by item.id
// ---------------------------------------------------------------------------

const rowMap = new Map<number, CachedRow>();

function getOrCreateRow(item: RowItem): CachedRow {
  let row = rowMap.get(item.id);
  if (row) {
    // Update existing
    if (row.label !== item.label) {
      row.labelNode.data = item.label;
      row.label = item.label;
    }
    return row;
  }

  // Create new
  const tr = document.createElement('tr');

  const td1 = document.createElement('td');
  td1.className = 'col-md-1';
  td1.textContent = String(item.id);

  const td2 = document.createElement('td');
  td2.className = 'col-md-4';
  const a = document.createElement('a');
  a.className = 'lbl';
  const labelNode = document.createTextNode(item.label);
  a.appendChild(labelNode);
  td2.appendChild(a);

  const td3 = document.createElement('td');
  td3.className = 'col-md-1';
  const a2 = document.createElement('a');
  a2.className = 'remove';
  const span = document.createElement('span');
  span.className = 'remove glyphicon glyphicon-remove';
  span.setAttribute('aria-hidden', 'true');
  a2.appendChild(span);
  td3.appendChild(a2);

  const td4 = document.createElement('td');
  td4.className = 'col-md-6';

  tr.appendChild(td1);
  tr.appendChild(td2);
  tr.appendChild(td3);
  tr.appendChild(td4);

  row = { tr, labelNode, label: item.label };
  rowMap.set(item.id, row);
  return row;
}

// ---------------------------------------------------------------------------
// Actions — all through Purity state updates
// ---------------------------------------------------------------------------

function run(count: number) {
  // Clear old entries from map
  rowMap.clear();
  data(buildData(count));
  selectedId(0);
}

function add() {
  data((d) => d.concat(buildData(1000)));
}

function update() {
  data((d) => {
    const c = d.slice();
    for (let i = 0; i < c.length; i += 10) {
      c[i] = { ...c[i], label: `${c[i].label} !!!` };
    }
    return c;
  });
}

function clearAll() {
  rowMap.clear();
  data([]);
  selectedId(0);
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

// ---------------------------------------------------------------------------
// Render — proper keyed reconciliation via Purity watch()
// ---------------------------------------------------------------------------

const tbody = document.getElementById('tbody')!;
let prevIds: number[] = [];

watch(() => {
  const items = data();
  const sel = selectedId();
  const len = items.length;

  // Build new id list + update rows
  const newIds = new Array<number>(len);
  const activeIds = new Set<number>();

  for (let i = 0; i < len; i++) {
    const item = items[i];
    newIds[i] = item.id;
    activeIds.add(item.id);
    const row = getOrCreateRow(item);
    row.tr.className = item.id === sel ? 'danger' : '';
  }

  // Remove rows no longer in data
  for (let i = 0; i < prevIds.length; i++) {
    const id = prevIds[i];
    if (!activeIds.has(id)) {
      const row = rowMap.get(id);
      if (row?.tr.parentNode) row.tr.parentNode.removeChild(row.tr);
      rowMap.delete(id);
    }
  }

  // Reconcile order — check if we can skip full rebuild
  const prevLen = prevIds.length;
  let needsFullRebuild = len !== prevLen;

  if (!needsFullRebuild) {
    for (let i = 0; i < len; i++) {
      if (prevIds[i] !== newIds[i]) {
        needsFullRebuild = true;
        break;
      }
    }
  }

  if (!needsFullRebuild) {
    // Same order — no DOM moves needed (just label/class updates above)
    prevIds = newIds;
    return;
  }

  // Detect pure append
  let isAppend = len > prevLen;
  if (isAppend) {
    for (let i = 0; i < prevLen; i++) {
      if (prevIds[i] !== newIds[i]) {
        isAppend = false;
        break;
      }
    }
  }

  if (isAppend && prevLen > 0) {
    // Pure append — just add new rows
    const frag = document.createDocumentFragment();
    for (let i = prevLen; i < len; i++) {
      frag.appendChild(rowMap.get(newIds[i])!.tr);
    }
    tbody.appendChild(frag);
  } else {
    // Full rebuild — clear and re-insert in order
    const frag = document.createDocumentFragment();
    for (let i = 0; i < len; i++) {
      frag.appendChild(rowMap.get(newIds[i])!.tr);
    }
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    tbody.appendChild(frag);
  }

  prevIds = newIds;
});

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------

tbody.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const id = +a.closest('tr')!.id;
  if (a.classList.contains('lbl')) {
    selectedId(id);
  } else if (a.classList.contains('remove')) {
    const row = rowMap.get(id);
    if (row?.tr.parentNode) row.tr.parentNode.removeChild(row.tr);
    rowMap.delete(id);
    data((d) => d.filter((item) => item.id !== id));
  }
});

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

document.getElementById('run')!.addEventListener('click', () => run(1000));
document.getElementById('runlots')!.addEventListener('click', () => run(10000));
document.getElementById('add')!.addEventListener('click', add);
document.getElementById('update')!.addEventListener('click', update);
document.getElementById('clear')!.addEventListener('click', clearAll);
document.getElementById('swaprows')!.addEventListener('click', swapRows);
