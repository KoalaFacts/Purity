<template>
  <tr v-for="item in filtered" :key="item.id">
    <td class="col-md-1">{{ item.id }}</td>
    <td class="col-md-4"><a class="lbl">{{ item.label }}</a></td>
  </tr>
</template>

<script setup lang="ts">
import { shallowRef, ref, computed } from 'vue';

const A = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const C = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const N = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

interface Item { id: number; label: string; }

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: mkLabel() };
  return d;
}

const data = shallowRef<Item[]>([]);
const query = ref('');

const filtered = computed(() => {
  const q = query.value.toLowerCase();
  if (!q) return data.value;
  return data.value.filter(item => item.label.toLowerCase().includes(q));
});

defineExpose({
  populate() { data.value = buildData(10000); },
  setQuery(q: string) { query.value = q; },
  clearSearch() { query.value = ''; },
});
</script>
