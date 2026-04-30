<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';

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

type SortMode = 'none' | 'id-asc' | 'id-desc' | 'label-asc';

const data = shallowRef<Item[]>([]);
const sortMode = ref<SortMode>('none');

const sorted = computed(() => {
  const s = data.value.slice();
  const mode = sortMode.value;
  if (mode === 'id-asc') s.sort((a, b) => a.id - b.id);
  else if (mode === 'id-desc') s.sort((a, b) => b.id - a.id);
  else if (mode === 'label-asc') s.sort((a, b) => a.label.localeCompare(b.label));
  return s;
});

function populate(n = 1000) {
  data.value = buildData(n);
  sortMode.value = 'none';
}
function sortIdAsc() {
  sortMode.value = 'id-asc';
}
function sortIdDesc() {
  sortMode.value = 'id-desc';
}
function sortLabelAsc() {
  sortMode.value = 'label-asc';
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue (Sort)</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="populate"
                  @click="populate()"
                >
                  Populate 1k
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="sort-id"
                  @click="sortIdAsc()"
                >
                  Sort by ID ↑
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="sort-id-desc"
                  @click="sortIdDesc()"
                >
                  Sort by ID ↓
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="sort-label"
                  @click="sortLabelAsc()"
                >
                  Sort by Label ↑
                </button>
              </div>
              <button
                type="button"
                id="populate-10k"
                style="display: none"
                @click="populate(10000)"
              >
                Populate 10000
              </button>
              <button type="button" id="populate-100" style="display: none" @click="populate(100)">
                Populate 100
              </button>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <tr v-for="item in sorted" :key="item.id">
            <td class="col-md-1">{{ item.id }}</td>
            <td class="col-md-4">
              <a href="#" class="lbl">{{ item.label }}</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
