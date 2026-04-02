<script lang="ts">
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

const props: { onHandle: (h: any) => void } = $props();

let cart: CartItem[] = $state.raw([]);

const itemCount: number = $derived(cart.reduce((s, i) => s + i.qty, 0));
const subtotal: number = $derived(cart.reduce((s, i) => s + i.price * i.qty, 0));
const tax: number = $derived(subtotal * 0.08);
const total: number = $derived(subtotal + tax);

$effect(() => { document.getElementById('item-count')!.textContent = String(itemCount); });
$effect(() => { document.getElementById('subtotal')!.textContent = subtotal.toFixed(2); });
$effect(() => { document.getElementById('tax')!.textContent = tax.toFixed(2); });
$effect(() => { document.getElementById('total')!.textContent = total.toFixed(2); });

props.onHandle({
  addItems(n: number) { cart = [...cart, ...randomItems(n)]; },
  incrementAll() { cart = cart.map(i => ({ ...i, qty: i.qty + 1 })); },
  removeFirst() { cart = cart.slice(1); },
  clearCart() { cart = []; },
});
</script>

{#each cart as item (item.id)}
  <tr>
    <td>{item.name}</td>
    <td>${item.price}</td>
    <td>{item.qty}</td>
    <td>${item.price * item.qty}</td>
  </tr>
{/each}
