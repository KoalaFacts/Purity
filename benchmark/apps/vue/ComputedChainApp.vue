<script setup lang="ts">
import { type ComputedRef, computed, type Ref, ref } from 'vue';

const source = ref(0);
const chain: ComputedRef<number>[] = [];
let prev: Ref<number> | ComputedRef<number> = source;
for (let i = 0; i < 1000; i++) {
  const p = prev;
  const c = computed(() => p.value * 2 + 1);
  chain.push(c);
  prev = c;
}
const last = chain[chain.length - 1];

function setup() {
  source.value = 0;
}
function update() {
  source.value = (Math.random() * 100) | 0;
}
function update10x() {
  for (let i = 0; i < 10; i++) {
    source.value = (Math.random() * 100) | 0;
  }
}
</script>

<template>
  <h1>Vue — Computed Chain (1000 levels)</h1>
  <button type="button" id="setup" @click="setup()">Setup Chain (1000 levels)</button>
  <button type="button" id="update" @click="update()">Update Source</button>
  <button type="button" id="update-10x" @click="update10x()">Update 10x</button>
  <div id="result">{{ last }}</div>
</template>
