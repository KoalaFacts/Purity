<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';

const A = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint',
  'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly',
  'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy',
];
const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const N = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

interface Item {
  id: number;
  label: string;
}

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
  return data.value.filter((item) => item.label.toLowerCase().includes(q));
});

function populate(n = 10000) {
  data.value = buildData(n);
}
function clearSearch() {
  query.value = '';
}
function onSearchInput(e: Event) {
  query.value = (e.target as HTMLInputElement).value;
}
</script>

<template>
  <div id="main"><div class="container">
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Vue (Filter)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad"><input type="text" id="search" placeholder="Search..." class="form-control" :value="query" @input="onSearchInput" /></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="populate" @click="populate()">Populate 10k</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear-search" @click="clearSearch()">Clear Search</button></div>
        <button type="button" id="populate-1k" style="display:none" @click="populate(1000)">Populate 1000</button>
        <button type="button" id="populate-10" style="display:none" @click="populate(10)">Populate 10</button>
        <button type="button" id="populate-100" style="display:none" @click="populate(100)">Populate 100</button>
      </div></div>
    </div></div>
    <table class="table table-hover table-striped test-data">
      <tbody>
        <tr v-for="item in filtered" :key="item.id">
          <td class="col-md-1">{{ item.id }}</td>
          <td class="col-md-4"><a href="#" class="lbl">{{ item.label }}</a></td>
        </tr>
      </tbody>
    </table>
  </div></div>
</template>
