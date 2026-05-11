<script setup lang="ts">
import { type ComputedRef, computed, type Ref, ref } from 'vue';

const source = ref(0);
const chain = ref<ComputedRef<number>[]>([]);
const MOD = 1_000_000_007;
const last = computed(() => {
  const c = chain.value;
  return c.length > 0 ? c[c.length - 1].value : 0;
});

function setup(levels = 1000) {
  const arr: ComputedRef<number>[] = [];
  let prev: Ref<number> | ComputedRef<number> = source;
  for (let i = 0; i < levels; i++) {
    const p = prev;
    const c = computed(() => (p.value * 2 + 1) % MOD);
    arr.push(c);
    prev = c;
  }
  chain.value = arr;
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

setup(1000);

defineExpose({ setup });
</script>

<template>
  <h1>Vue — Computed Chain (1000 levels)</h1>
  <button type="button" id="setup" @click="setup()">Setup Chain (1000 levels)</button>
  <button type="button" id="update" @click="update()">Update Source</button>
  <button type="button" id="update-10x" @click="update10x()">Update 10x</button>
  <button type="button" id="setup-10" style="display: none">Setup 10</button>
  <button type="button" id="setup-100" style="display: none">Setup 100</button>
  <button type="button" id="setup-10k" style="display: none">Setup 10k</button>
  <div id="result">{{ last }}</div>
</template>
