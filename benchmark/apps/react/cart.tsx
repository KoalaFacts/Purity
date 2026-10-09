// Shopping cart benchmark — idiomatic React version.
// Uses: useState, useMemo, map. Plain React, no signals.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: string }) {
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
  const [cart, setCart] = useState<CartItem[]>([]);

  const itemCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const tax = subtotal * 0.08;
  const total = subtotal + tax;

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Cart)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="add-1"
                  onClick={() => setCart((c) => [...c, ...randomItems(1)])}
                >
                  Add 1 Item
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="add-100"
                  onClick={() => setCart((c) => [...c, ...randomItems(100)])}
                >
                  Add 100 Items
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="add-1000"
                  onClick={() => setCart((c) => [...c, ...randomItems(1000)])}
                >
                  Add 1000 Items
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="increment-all"
                  onClick={() => setCart((c) => c.map((i) => ({ ...i, qty: i.qty + 1 })))}
                >
                  +1 All Quantities
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="remove-first"
                  onClick={() => setCart((c) => c.slice(1))}
                >
                  Remove First
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="clear-cart"
                  onClick={() => setCart([])}
                >
                  Clear Cart
                </button>
              </div>
              <HBtn id="add-10" onClick={() => setCart((c) => [...c, ...randomItems(10)])}>
                Add 10 Items
              </HBtn>
              <HBtn id="add-10k" onClick={() => setCart((c) => [...c, ...randomItems(10000)])}>
                Add 10,000 Items
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="stats">
        <span id="item-count">{itemCount}</span> items | Subtotal: $
        <span id="subtotal">{subtotal.toFixed(2)}</span> | Tax: $
        <span id="tax">{tax.toFixed(2)}</span> | Total: $
        <span id="total">{total.toFixed(2)}</span>
      </div>
      <table className="table table-hover table-striped test-data">
        <tbody id="tbody">
          {cart.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>${item.price}</td>
              <td>{item.qty}</td>
              <td>${item.price * item.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
