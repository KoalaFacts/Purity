<template>
  <div v-for="card in cards" :key="card.id" class="card">
    <span class="id">{{ card.id }}</span>
    <span class="label">{{ card.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue';

interface Card {
  id: number;
  label: string;
}

let nid = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Card ${nid - 1}` };
  return d;
}

const cards = shallowRef<Card[]>([]);

defineExpose({
  create(n: number) {
    cards.value = buildCards(n);
  },
  destroyAll() {
    cards.value = [];
  },
  replace() {
    cards.value = buildCards(1000);
  },
});
</script>
