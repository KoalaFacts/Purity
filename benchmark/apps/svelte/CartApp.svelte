<script lang="ts">
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

const catalog: { name: string; price: number }[] = [];
for (let i = 0; i < 100; i++)
  catalog.push({ name: `${NAMES[rnd(NAMES.length)]}-${i}`, price: rnd(100) + 1 });

function randomItems(n: number): CartItem[] {
  const items: CartItem[] = [];
  for (let i = 0; i < n; i++) {
    const c = catalog[rnd(100)];
    items.push({ id: nextId++, name: c.name, price: c.price, qty: 1 });
  }
  return items;
}

let cart: CartItem[] = $state.raw([]);

const itemCount = $derived(cart.reduce((s, i) => s + i.qty, 0));
const subtotal = $derived(cart.reduce((s, i) => s + i.price * i.qty, 0));
const tax = $derived(subtotal * 0.08);
const total = $derived(subtotal + tax);

function addItems(n: number) {
  cart = [...cart, ...randomItems(n)];
}
function incrementAll() {
  cart = cart.map((i) => ({ ...i, qty: i.qty + 1 }));
}
function removeFirst() {
  cart = cart.slice(1);
}
function clearCart() {
  cart = [];
}
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Cart)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add-1" onclick={() => addItems(1)}>Add 1 Item</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add-100" onclick={() => addItems(100)}>Add 100 Items</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add-1000" onclick={() => addItems(1000)}>Add 1000 Items</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="increment-all" onclick={incrementAll}>+1 All Quantities</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="remove-first" onclick={removeFirst}>Remove First</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear-cart" onclick={clearCart}>Clear Cart</button></div>
      <button type="button" id="add-10" style="display:none" onclick={() => addItems(10)}>Add 10 Items</button>
      <button type="button" id="add-10k" style="display:none" onclick={() => addItems(10000)}>Add 10000 Items</button>
    </div></div>
  </div></div>
  <div id="stats">
    <span id="item-count">{itemCount}</span> items |
    Subtotal: $<span id="subtotal">{subtotal.toFixed(2)}</span> |
    Tax: $<span id="tax">{tax.toFixed(2)}</span> |
    Total: $<span id="total">{total.toFixed(2)}</span>
  </div>
  <table class="table table-hover table-striped test-data">
    <tbody>
      {#each cart as item (item.id)}
        <tr>
          <td>{item.name}</td>
          <td>${item.price}</td>
          <td>{item.qty}</td>
          <td>${item.price * item.qty}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div></div>
