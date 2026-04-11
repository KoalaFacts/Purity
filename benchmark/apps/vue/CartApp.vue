<script setup lang="ts">
import { computed, shallowRef } from "vue";

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

function addItems(n: number) {
  cart.value = [...cart.value, ...randomItems(n)];
}
function incrementAll() {
  cart.value = cart.value.map((i) => ({ ...i, qty: i.qty + 1 }));
}
function removeFirst() {
  cart.value = cart.value.slice(1);
}
function clearCart() {
  cart.value = [];
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue (Cart)</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="add-1"
                  @click="addItems(1)"
                >
                  Add 1 Item
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="add-100"
                  @click="addItems(100)"
                >
                  Add 100 Items
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="add-1000"
                  @click="addItems(1000)"
                >
                  Add 1000 Items
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="increment-all"
                  @click="incrementAll()"
                >
                  +1 All Quantities
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="remove-first"
                  @click="removeFirst()"
                >
                  Remove First
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="clear-cart"
                  @click="clearCart()"
                >
                  Clear Cart
                </button>
              </div>
              <button type="button" id="add-10" style="display: none" @click="addItems(10)">
                Add 10 Items
              </button>
              <button type="button" id="add-10k" style="display: none" @click="addItems(10000)">
                Add 10000 Items
              </button>
            </div>
          </div>
        </div>
      </div>
      <div id="stats">
        <span id="item-count">{{ itemCount }}</span> items | Subtotal: $<span id="subtotal">{{
          subtotal.toFixed(2)
        }}</span>
        | Tax: $<span id="tax">{{ tax.toFixed(2) }}</span> | Total: $<span id="total">{{
          total.toFixed(2)
        }}</span>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <tr v-for="item in cart" :key="item.id">
            <td>{{ item.name }}</td>
            <td>${{ item.price }}</td>
            <td>{{ item.qty }}</td>
            <td>${{ item.price * item.qty }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
