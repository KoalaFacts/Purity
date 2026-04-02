import { For, createEffect, createMemo, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

interface CartItem { id: number; name: string; price: number; qty: number; }

const NAMES = ['Widget','Gadget','Doohickey','Thingamajig','Gizmo','Contraption','Apparatus','Device','Implement','Mechanism'];
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

export function createCartApp(tbody: HTMLElement) {
  const [cart, setCart] = createSignal<CartItem[]>([]);

  const itemCount = createMemo(() => cart().reduce((s, i) => s + i.qty, 0));
  const subtotal = createMemo(() => cart().reduce((s, i) => s + i.price * i.qty, 0));
  const tax = createMemo(() => subtotal() * 0.08);
  const total = createMemo(() => subtotal() + tax());

  render(() => {
    createEffect(() => { document.getElementById('item-count')!.textContent = String(itemCount()); });
    createEffect(() => { document.getElementById('subtotal')!.textContent = subtotal().toFixed(2); });
    createEffect(() => { document.getElementById('tax')!.textContent = tax().toFixed(2); });
    createEffect(() => { document.getElementById('total')!.textContent = total().toFixed(2); });

    return (
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
    );
  }, tbody);

  document.getElementById('add-1')!.addEventListener('click', () => {
    setCart(c => [...c, ...randomItems(1)]);
  });
  document.getElementById('add-100')!.addEventListener('click', () => {
    setCart(c => [...c, ...randomItems(100)]);
  });
  document.getElementById('add-1000')!.addEventListener('click', () => {
    setCart(c => [...c, ...randomItems(1000)]);
  });
  document.getElementById('increment-all')!.addEventListener('click', () => {
    setCart(c => c.map(i => ({ ...i, qty: i.qty + 1 })));
  });
  document.getElementById('remove-first')!.addEventListener('click', () => {
    setCart(c => c.slice(1));
  });
  document.getElementById('clear-cart')!.addEventListener('click', () => {
    setCart([]);
  });
}
