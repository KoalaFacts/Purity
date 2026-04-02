<template>
  <tr v-for="row in data" :key="row.id" :class="{ danger: row.id === selectedId }">
    <td class="col-md-1">{{ row.id }}</td>
    <td class="col-md-4"><a class="lbl">{{ row.label }}</a></td>
    <td class="col-md-1"><a class="remove"><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
    <td class="col-md-6"></td>
  </tr>
</template>

<script setup lang="ts">
import { ref, shallowRef } from 'vue';

const A = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
];
const C = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
];
const N = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

interface RowItem {
  id: number;
  label: string;
}

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;
function mkData(n: number): RowItem[] {
  const d = new Array<RowItem>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: mkLabel() };
  return d;
}

const data = shallowRef<RowItem[]>([]);
const selectedId = ref(0);

defineExpose({
  run(count: number) {
    data.value = mkData(count);
    selectedId.value = 0;
  },
  add() {
    data.value = data.value.concat(mkData(1000));
  },
  update() {
    const c = data.value.slice();
    for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
    data.value = c;
  },
  select(id: number) {
    selectedId.value = id;
  },
  swapRows() {
    const d = data.value;
    if (d.length > 998) {
      const c = d.slice();
      const t = c[1];
      c[1] = c[998];
      c[998] = t;
      data.value = c;
    }
  },
  remove(id: number) {
    data.value = data.value.filter((x) => x.id !== id);
  },
  clear() {
    data.value = [];
    selectedId.value = 0;
  },
  getData() {
    return data.value;
  },
});
</script>
