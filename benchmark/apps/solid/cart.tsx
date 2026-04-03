// Shopping cart benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createMemo, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
}

const NAMES = [
  'Widget', 'Gadget', 'Doohickey', 'Thingamajig', 'Gizmo',
  'Contraption', 'Apparatus', 'Device', 'Implement', 'Mechanism',
];
let nextId = 1;
const rnd = (m: number) => (Math.random() * m) | 0;

const catalog: { name: string; price: number }[] = [];
for (let i = 0; i < 100; i++) {
  catalog.push({ name: `${NAMES[rnd(NAMES.length)]}-${i}`, price: rnd(100) + 1 });
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
// Module-level signals
// ---------------------------------------------------------------------------

const [cart, setCart] = createSignal<CartItem[]>([]);

const itemCount = createMemo(() => cart().reduce((s, i) => s + i.qty, 0));
const subtotal = createMemo(() => cart().reduce((s, i) => s + i.price * i.qty, 0));
const tax = createMemo(() => subtotal() * 0.08);
const total = createMemo(() => subtotal() + tax());

// ---------------------------------------------------------------------------
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: any }) {
  return (
    <button type="button" id={props.id} style={{ display: 'none' }} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Solid (Cart)</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add-1" onClick={() => setCart((c) => [...c, ...randomItems(1)])}>Add 1 Item</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add-100" onClick={() => setCart((c) => [...c, ...randomItems(100)])}>Add 100 Items</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add-1000" onClick={() => setCart((c) => [...c, ...randomItems(1000)])}>Add 1000 Items</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="increment-all" onClick={() => setCart((c) => c.map((i) => ({ ...i, qty: i.qty + 1 })))}>+1 All Quantities</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="remove-first" onClick={() => setCart((c) => c.slice(1))}>Remove First</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear-cart" onClick={() => setCart([])}>Clear Cart</button>
              </div>
              <HBtn id="add-10" onClick={() => setCart((c) => [...c, ...randomItems(10)])}>Add 10 Items</HBtn>
              <HBtn id="add-10k" onClick={() => setCart((c) => [...c, ...randomItems(10000)])}>Add 10,000 Items</HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="stats">
        <span id="item-count">{itemCount()}</span> items |
        Subtotal: $<span id="subtotal">{subtotal().toFixed(2)}</span> |
        Tax: $<span id="tax">{tax().toFixed(2)}</span> |
        Total: $<span id="total">{total().toFixed(2)}</span>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody id="tbody">
          <For each={cart()}>
            {(item: CartItem) => (
              <tr>
                <td>{item.name}</td>
                <td>${item.price}</td>
                <td>{item.qty}</td>
                <td>${item.price * item.qty}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </>
  );
}

render(App, document.getElementById('app')!);
