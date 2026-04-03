<script setup lang="ts">
import { ref } from 'vue';

interface Field {
  id: number;
  value: string;
}

const fields = ref<Field[]>([]);
const result = ref('—');

function createFields(count: number) {
  const arr: Field[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: i + 1, value: '' });
  }
  fields.value = arr;
  result.value = `Created ${count} fields`;
}

function updateAll() {
  for (let i = 0; i < fields.value.length; i++) {
    fields.value[i].value = `updated-${fields.value[i].id}`;
  }
  result.value = `Updated ${fields.value.length} fields`;
}

function clearAll() {
  for (let i = 0; i < fields.value.length; i++) {
    fields.value[i].value = '';
  }
  result.value = `Cleared ${fields.value.length} fields`;
}

function readAll() {
  let count = 0;
  for (let i = 0; i < fields.value.length; i++) {
    void fields.value[i].value;
    count++;
  }
  result.value = `Read ${count} fields`;
}
</script>

<template>
  <div id="main"><div class="container">
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Vue (Binding)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-100" @click="createFields(100)">Create 100 Fields</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-1000" @click="createFields(1000)">Create 1000 Fields</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update-all" @click="updateAll()">Update All</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear-all" @click="clearAll()">Clear All</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="read-all" @click="readAll()">Read All</button></div>
        <button type="button" id="create-10k" style="display:none" @click="createFields(10000)">Create 10000 Fields</button>
        <button type="button" id="create-10" style="display:none" @click="createFields(10)">Create 10 Fields</button>
      </div></div>
    </div></div>
    <div id="result">{{ result }}</div>
    <div id="container">
      <div v-for="field in fields" :key="field.id">
        <label>Field {{ field.id }}:</label>
        <input v-model="field.value" />
      </div>
    </div>
  </div></div>
</template>
