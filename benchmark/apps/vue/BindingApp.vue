<template>
  <div v-for="field in fields" :key="field.id">
    <label>Field {{ field.id }}:</label>
    <input v-model="field.value" />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';

interface Field {
  id: number;
  value: string;
}

const props = defineProps<{ result: HTMLElement }>();

const fields = ref<Field[]>([]);

function createFields(count: number) {
  const arr: Field[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(reactive({ id: i + 1, value: '' }));
  }
  fields.value = arr;
  props.result.textContent = `Created ${count} fields`;
}

function updateAll() {
  for (let i = 0; i < fields.value.length; i++) {
    fields.value[i].value = `updated-${fields.value[i].id}`;
  }
  props.result.textContent = `Updated ${fields.value.length} fields`;
}

function clearAll() {
  for (let i = 0; i < fields.value.length; i++) {
    fields.value[i].value = '';
  }
  props.result.textContent = `Cleared ${fields.value.length} fields`;
}

function readAll() {
  let count = 0;
  for (let i = 0; i < fields.value.length; i++) {
    void fields.value[i].value;
    count++;
  }
  props.result.textContent = `Read ${count} fields`;
}

defineExpose({ createFields, updateAll, clearAll, readAll });
</script>
