<template>
  <span>{{ total }}</span>
</template>

<script setup lang="ts">
import { type ComputedRef, computed, type Ref, ref } from 'vue';

const sources: Ref<number>[] = [];
const results: ComputedRef<number>[] = [];

for (let i = 0; i < 1000; i++) {
  const a = ref(i);
  const b = computed(() => a.value * 2);
  const c = computed(() => a.value * 3);
  const d = computed(() => b.value + c.value);
  sources.push(a);
  results.push(d);
}

const _total = computed(() => {
  let s = 0;
  for (let i = 0; i < results.length; i++) s += results[i].value;
  return s;
});

function updateAll() {
  for (let i = 0; i < sources.length; i++) {
    sources[i].value = i + ((Math.random() * 100) | 0);
  }
}

function updateOne() {
  sources[0].value = (Math.random() * 100) | 0;
}

defineExpose({ updateAll, updateOne });
</script>
