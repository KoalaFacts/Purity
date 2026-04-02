<template>
  <div v-for="item in items" :key="item.id">
    <input type="checkbox" :checked="item.selected" />
    {{ item.label }}
  </div>
</template>

<script setup lang="ts">
import { shallowRef, computed, watchEffect } from 'vue';

interface SelectItem { id: number; label: string; selected: boolean; }

const props = defineProps<{
  countEl: HTMLElement;
  totalEl: HTMLElement;
  allSelectedEl: HTMLElement;
}>();

const items = shallowRef<SelectItem[]>([]);
const selectedCount = computed(() => items.value.filter(i => i.selected).length);
const allSelected = computed(() => items.value.length > 0 && items.value.every(i => i.selected));

watchEffect(() => { props.countEl.textContent = String(selectedCount.value); });
watchEffect(() => { props.totalEl.textContent = String(items.value.length); });
watchEffect(() => { props.allSelectedEl.textContent = allSelected.value ? 'Yes' : 'No'; });

function buildItems(): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < 1000; i++) {
    arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  }
  return arr;
}

function populate() { items.value = buildItems(); }
function selectAll() { items.value = items.value.map(i => ({ ...i, selected: true })); }
function deselectAll() { items.value = items.value.map(i => ({ ...i, selected: false })); }
function toggleAll() { items.value = items.value.map(i => ({ ...i, selected: !i.selected })); }
function toggleEven() { items.value = items.value.map(i => i.id % 2 === 0 ? { ...i, selected: !i.selected } : i); }

defineExpose({ populate, selectAll, deselectAll, toggleAll, toggleEven });
</script>
