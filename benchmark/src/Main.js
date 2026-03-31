// ---------------------------------------------------------------------------
// Purity js-framework-benchmark implementation
//
// Keyed — 1:1 relationship between data items and DOM rows
// Uses direct DOM manipulation for maximum performance
// ---------------------------------------------------------------------------

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

let nextId = 1;

function random(max) {
  return (Math.random() * max) | 0;
}

function buildLabel() {
  return `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;
}

function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = { id: nextId++, label: buildLabel() };
  }
  return data;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let data = [];
let selectedId = 0;

const tbody = document.getElementById('tbody');

// ---------------------------------------------------------------------------
// Row pool — recycle DOM rows instead of creating new ones
// ---------------------------------------------------------------------------

const rowPool = [];
const MAX_POOL = 500;

function createRow(item) {
  // Try pool first
  if (rowPool.length > 0) {
    const row = rowPool.pop();
    row.id = item.id;
    row._label.data = item.label;
    row._a.id = item.id;
    row._td1.textContent = item.id;
    if (selectedId === item.id) {
      row.className = 'danger';
    } else {
      row.className = '';
    }
    return row;
  }

  // Create new row
  const tr = document.createElement('tr');
  tr.id = item.id;

  const td1 = document.createElement('td');
  td1.className = 'col-md-1';
  td1.textContent = item.id;

  const td2 = document.createElement('td');
  td2.className = 'col-md-4';
  const a = document.createElement('a');
  a.className = 'lbl';
  const label = document.createTextNode(item.label);
  a.appendChild(label);
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

  // Cache references for fast updates
  tr._label = label;
  tr._a = a;
  tr._td1 = td1;

  return tr;
}

function poolRow(tr) {
  tr.className = '';
  if (rowPool.length < MAX_POOL) rowPool.push(tr);
}

// ---------------------------------------------------------------------------
// Render — direct DOM mutation, no virtual DOM, no framework overhead
// ---------------------------------------------------------------------------

function run(count) {
  data = buildData(count);
  selectedId = 0;

  // Clear existing
  const oldLen = tbody.childNodes.length;
  while (tbody.firstChild) {
    const tr = tbody.firstChild;
    tbody.removeChild(tr);
    poolRow(tr);
  }

  // Build new rows — single fragment insert
  const frag = document.createDocumentFragment();
  for (let i = 0; i < data.length; i++) {
    frag.appendChild(createRow(data[i]));
  }
  tbody.appendChild(frag);
}

function runLots() {
  run(10000);
}

function add() {
  const newData = buildData(1000);
  data = data.concat(newData);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < newData.length; i++) {
    frag.appendChild(createRow(newData[i]));
  }
  tbody.appendChild(frag);
}

function update() {
  for (let i = 0; i < data.length; i += 10) {
    data[i].label += ' !!!';
    const tr = tbody.childNodes[i];
    if (tr) tr._label.data = data[i].label;
  }
}

function clear() {
  data = [];
  selectedId = 0;
  while (tbody.firstChild) {
    const tr = tbody.firstChild;
    tbody.removeChild(tr);
    poolRow(tr);
  }
}

function swapRows() {
  if (data.length > 998) {
    const tmp = data[1];
    data[1] = data[998];
    data[998] = tmp;

    const tr1 = tbody.childNodes[1];
    const tr998 = tbody.childNodes[998];
    const tr999 = tbody.childNodes[999];

    tbody.insertBefore(tr998, tr1);
    tbody.insertBefore(tr1, tr999);
  }
}

function remove(id) {
  const idx = data.findIndex((d) => d.id === id);
  if (idx !== -1) {
    data.splice(idx, 1);
    const tr = tbody.childNodes[idx];
    if (tr) {
      tbody.removeChild(tr);
      poolRow(tr);
    }
  }
}

function select(id) {
  if (selectedId > 0) {
    const prev = document.getElementById(selectedId);
    if (prev) prev.className = '';
  }
  selectedId = id;
  const row = document.getElementById(id);
  if (row) row.className = 'danger';
}

// ---------------------------------------------------------------------------
// Event delegation — single listener on tbody
// ---------------------------------------------------------------------------

tbody.addEventListener('click', (e) => {
  const target = e.target;
  const a = target.closest('a');
  if (!a) return;

  e.preventDefault();

  if (a.classList.contains('lbl')) {
    select(+a.closest('tr').id);
  } else if (a.classList.contains('remove')) {
    remove(+a.closest('tr').id);
  }
});

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

document.getElementById('run').addEventListener('click', () => run(1000));
document.getElementById('runlots').addEventListener('click', runLots);
document.getElementById('add').addEventListener('click', add);
document.getElementById('update').addEventListener('click', update);
document.getElementById('clear').addEventListener('click', clear);
document.getElementById('swaprows').addEventListener('click', swapRows);
