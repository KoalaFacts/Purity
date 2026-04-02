<template>
  <table v-if="visible && data.length > 0" class="table table-hover table-striped test-data">
    <tbody>
      <tr v-for="item in data" :key="item.id">
        <td class="col-md-1">{{ item.id }}</td>
        <td class="col-md-4">{{ item.label }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { shallowRef, ref } from 'vue';

interface Item { id: number; label: string; }

let nid = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Item ${nid - 1}` };
  return d;
}

const data = shallowRef<Item[]>([]);
const visible = ref(true);

defineExpose({
  populate() { data.value = buildData(1000); visible.value = true; },
  toggle() { visible.value = !visible.value; },
  toggle10x() { for (let i = 0; i < 10; i++) visible.value = !visible.value; },
});
</script>
