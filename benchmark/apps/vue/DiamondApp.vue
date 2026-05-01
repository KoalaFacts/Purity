<script setup lang="ts">
import { type ComputedRef, computed, type Ref, ref } from 'vue';

const sources = ref<Ref<number>[]>([]);
const results = ref<ComputedRef<number>[]>([]);

const total = computed(() => {
  let s = 0;
  const r = results.value;
  for (let i = 0; i < r.length; i++) s += r[i].value;
  return s;
});

function setup(count = 1000) {
  const src: Ref<number>[] = [];
  const res: ComputedRef<number>[] = [];
  for (let i = 0; i < count; i++) {
    const a = ref(i);
    const b = computed(() => a.value * 2);
    const c = computed(() => a.value * 3);
    const d = computed(() => b.value + c.value);
    src.push(a);
    res.push(d);
  }
  sources.value = src;
  results.value = res;
}
function updateAll() {
  const src = sources.value;
  for (let i = 0; i < src.length; i++) {
    src[i].value = i + ((Math.random() * 100) | 0);
  }
}
function updateOne() {
  const src = sources.value;
  if (src.length > 0) src[0].value = (Math.random() * 100) | 0;
}

setup(1000);

defineExpose({ setup });
</script>

<template>
  <h1>Vue — Diamond Dependency (1000 patterns)</h1>
  <button type="button" id="setup" @click="setup()">Setup 1000 Diamonds</button>
  <button type="button" id="update-all" @click="updateAll()">Update All Sources</button>
  <button type="button" id="update-one" @click="updateOne()">Update One Source</button>
  <button type="button" id="setup-10" style="display: none">Setup 10</button>
  <button type="button" id="setup-100" style="display: none">Setup 100</button>
  <button type="button" id="setup-diamonds" style="display: none">Setup 1000</button>
  <button type="button" id="setup-10k" style="display: none">Setup 10k</button>
  <div id="result">{{ total }}</div>
</template>
