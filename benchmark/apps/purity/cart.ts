// Shopping cart benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
  qtyNode?: Text;
  lineNode?: Text;
}

const NAMES = [
  'Widget',
  'Gadget',
  'Doohickey',
  'Thingamajig',
  'Gizmo',
  'Contraption',
  'Apparatus',
  'Device',
  'Implement',
  'Mechanism',
];
let nextId = 1;
let seed = 1;
const rnd = (m: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % m;
};

const catalog: CartItem[] = [];
for (let i = 0; i < 100; i++) {
  catalog.push({ id: i, name: `${NAMES[rnd(NAMES.length)]}-${i}`, price: rnd(100) + 1, qty: 0 });
}

function randomItems(n: number): CartItem[] {
  const items = new Array<CartItem>(n);
  for (let i = 0; i < n; i++) {
    const c = catalog[rnd(100)];
    items[i] = { id: nextId++, name: c.name, price: c.price, qty: 1 };
  }
  return items;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const cart = state<CartItem[]>([]);
const itemCount = state(0);
const subtotal = state(0);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const tax = compute(() => subtotal() * 0.08);
const total = compute(() => subtotal() + tax());

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function addItems(n: number) {
  const added = randomItems(n);
  let addedSubtotal = 0;
  for (let i = 0; i < added.length; i++) addedSubtotal += added[i].price;
  cart(cart().concat(added));
  itemCount(itemCount.peek() + n);
  subtotal(subtotal.peek() + addedSubtotal);
}

function incrementAll() {
  const items = cart();
  let addedSubtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.qty++;
    addedSubtotal += item.price;
    if (item.qtyNode) item.qtyNode.data = String(item.qty);
    if (item.lineNode) item.lineNode.data = `$${item.price * item.qty}`;
  }
  itemCount(itemCount.peek() + items.length);
  subtotal(subtotal.peek() + addedSubtotal);
}

function removeFirst() {
  const items = cart();
  const first = items[0];
  if (!first) return;
  cart(items.slice(1));
  itemCount(itemCount.peek() - first.qty);
  subtotal(subtotal.peek() - first.price * first.qty);
}

function clearCart() {
  cart([]);
  itemCount(0);
  subtotal(0);
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
      <div class="col-md-6"><h1>Purity (Cart)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="add-1" @click=${() => addItems(1)}>Add 1 Item</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="add-100" @click=${() => addItems(100)}>Add 100 Items</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="add-1000" @click=${() => addItems(1000)}>Add 1000 Items</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="increment-all" @click=${incrementAll}>+1 All Quantities</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="remove-first" @click=${removeFirst}>Remove First</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="clear-cart" @click=${clearCart}>Clear Cart</button>
        </div>
        ${hBtn('add-10', 'Add 10', () => addItems(10))}
        ${hBtn('add-10k', 'Add 10k', () => addItems(10000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Stats display
// ---------------------------------------------------------------------------

function Stats() {
  return html`
    <div id="stats">
      <span id="item-count">${() => String(itemCount())}</span> items |
      Subtotal: $<span id="subtotal">${() => subtotal().toFixed(2)}</span> |
      Tax: $<span id="tax">${() => tax().toFixed(2)}</span> |
      Total: $<span id="total">${() => total().toFixed(2)}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const tbody = document.getElementById('tbody')!;

function CartRow(item: CartItem): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const name = document.createElement('td');
  name.textContent = item.name;
  tr.appendChild(name);

  const price = document.createElement('td');
  price.textContent = `$${item.price}`;
  tr.appendChild(price);

  const qty = document.createElement('td');
  item.qtyNode = document.createTextNode(String(item.qty));
  qty.appendChild(item.qtyNode);
  tr.appendChild(qty);

  const line = document.createElement('td');
  item.lineNode = document.createTextNode(`$${item.price * item.qty}`);
  line.appendChild(item.lineNode);
  tr.appendChild(line);

  return tr;
}

const fragment = each(
  () => cart(),
  (item: CartItem) => CartRow(item),
  (item: CartItem) => item.id,
);
tbody.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
mount(Stats, document.getElementById('stats-container')!);
