<template>
  <tr v-for="item in cart" :key="item.id">
    <td>{{ item.name }}</td>
    <td>${{ item.price }}</td>
    <td>{{ item.qty }}</td>
    <td>${{ item.price * item.qty }}</td>
  </tr>
</template>

<script setup lang="ts">
import { shallowRef, computed, watch } from 'vue';

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

const cart = shallowRef<CartItem[]>([]);

const itemCount = computed(() => cart.value.reduce((s, i) => s + i.qty, 0));
const subtotal = computed(() => cart.value.reduce((s, i) => s + i.price * i.qty, 0));
const tax = computed(() => subtotal.value * 0.08);
const total = computed(() => subtotal.value + tax.value);

watch(itemCount, (v) => { document.getElementById('item-count')!.textContent = String(v); }, { flush: 'post' });
watch(subtotal, (v) => { document.getElementById('subtotal')!.textContent = v.toFixed(2); }, { flush: 'post' });
watch(tax, (v) => { document.getElementById('tax')!.textContent = v.toFixed(2); }, { flush: 'post' });
watch(total, (v) => { document.getElementById('total')!.textContent = v.toFixed(2); }, { flush: 'post' });

defineExpose({
  addItems(n: number) { cart.value = [...cart.value, ...randomItems(n)]; },
  incrementAll() { cart.value = cart.value.map(i => ({ ...i, qty: i.qty + 1 })); },
  removeFirst() { cart.value = cart.value.slice(1); },
  clearCart() { cart.value = []; },
});
</script>
