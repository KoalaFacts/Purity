// Shopping cart benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state } from "@purityjs/core";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

const NAMES = [
  "Widget",
  "Gadget",
  "Doohickey",
  "Thingamajig",
  "Gizmo",
  "Contraption",
  "Apparatus",
  "Device",
  "Implement",
  "Mechanism",
];
let nextId = 1;
const rnd = (m: number) => (Math.random() * m) | 0;

const catalog: CartItem[] = [];
for (let i = 0; i < 100; i++) {
  catalog.push({ id: i, name: `${NAMES[rnd(NAMES.length)]}-${i}`, price: rnd(100) + 1, qty: 0 });
}

function randomItems(n: number): CartItem[] {
  const items: CartItem[] = [];
  for (let i = 0; i < n; i++) {
    const c = catalog[rnd(100)];
    items.push({ id: nextId++, name: c.name, price: c.price, qty: 1 });
  }
  return items;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const cart = state<CartItem[]>([]);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const itemCount = compute(() => cart().reduce((s, i) => s + i.qty, 0));
const subtotal = compute(() => cart().reduce((s, i) => s + i.price * i.qty, 0));
const tax = compute(() => subtotal() * 0.08);
const total = compute(() => subtotal() + tax());

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function addItems(n: number) {
  cart([...cart(), ...randomItems(n)]);
}

function incrementAll() {
  cart(cart().map((i) => ({ ...i, qty: i.qty + 1 })));
}

function removeFirst() {
  cart(cart().slice(1));
}

function clearCart() {
  cart([]);
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>
    ${label}
  </button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6"><h1>Purity (Cart)</h1></div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="add-1"
                @click=${() => addItems(1)}
              >
                Add 1 Item
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="add-100"
                @click=${() => addItems(100)}
              >
                Add 100 Items
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="add-1000"
                @click=${() => addItems(1000)}
              >
                Add 1000 Items
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="increment-all"
                @click=${incrementAll}
              >
                +1 All Quantities
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="remove-first"
                @click=${removeFirst}
              >
                Remove First
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="clear-cart"
                @click=${clearCart}
              >
                Clear Cart
              </button>
            </div>
            ${hBtn("add-10", "Add 10", () => addItems(10))}
            ${hBtn("add-10k", "Add 10k", () => addItems(10000))}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Stats display
// ---------------------------------------------------------------------------

function Stats() {
  return html`
    <div id="stats">
      <span id="item-count">${() => String(itemCount())}</span> items | Subtotal: $<span
        id="subtotal"
        >${() => subtotal().toFixed(2)}</span
      >
      | Tax: $<span id="tax">${() => tax().toFixed(2)}</span> | Total: $<span id="total"
        >${() => total().toFixed(2)}</span
      >
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const tbody = document.getElementById("tbody")!;

const fragment = each(
  () => cart(),
  (item: CartItem) =>
    html`
      <tr>
        <td>${item.name}</td>
        <td>$${String(item.price)}</td>
        <td>${String(item.qty)}</td>
        <td>$${String(item.price * item.qty)}</td>
      </tr>
    ` as unknown as HTMLTableRowElement,
  (item: CartItem) => item.id,
);
tbody.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById("app")!);
mount(Stats, document.getElementById("stats-container")!);
