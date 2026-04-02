import { compute, each, html, state, watch } from '@purity/core';

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

export function createCartApp(tbody: HTMLElement) {
  const cart = state<CartItem[]>([]);

  const itemCount = compute(() => cart().reduce((s, i) => s + i.qty, 0));
  const subtotal = compute(() => cart().reduce((s, i) => s + i.price * i.qty, 0));
  const tax = compute(() => subtotal() * 0.08);
  const total = compute(() => subtotal() + tax());

  watch(() => {
    document.getElementById('item-count')!.textContent = String(itemCount());
  });
  watch(() => {
    document.getElementById('subtotal')!.textContent = subtotal().toFixed(2);
  });
  watch(() => {
    document.getElementById('tax')!.textContent = tax().toFixed(2);
  });
  watch(() => {
    document.getElementById('total')!.textContent = total().toFixed(2);
  });

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

  document.getElementById('add-1')!.addEventListener('click', () => {
    cart([...cart(), ...randomItems(1)]);
  });
  document.getElementById('add-100')!.addEventListener('click', () => {
    cart([...cart(), ...randomItems(100)]);
  });
  document.getElementById('add-1000')!.addEventListener('click', () => {
    cart([...cart(), ...randomItems(1000)]);
  });
  document.getElementById('increment-all')!.addEventListener('click', () => {
    cart(cart().map((i) => ({ ...i, qty: i.qty + 1 })));
  });
  document.getElementById('remove-first')!.addEventListener('click', () => {
    cart(cart().slice(1));
  });
  document.getElementById('clear-cart')!.addEventListener('click', () => {
    cart([]);
  });
}
