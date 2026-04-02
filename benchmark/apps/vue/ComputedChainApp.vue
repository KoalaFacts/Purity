<template>
  <span>{{ last }}</span>
</template>

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
const _last = chain[chain.length - 1];

function setSource(v: number) {
  source.value = v;
}

defineExpose({ setSource });
</script>
