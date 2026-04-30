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

function run(count: number) {
  data.value = mkData(count);
  selectedId.value = 0;
}
function add(count = 1000) {
  data.value = data.value.concat(mkData(count));
}
function update() {
  const c = data.value.slice();
  for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
  data.value = c;
}
function swapRows() {
  const d = data.value;
  if (d.length > 998) {
    const c = d.slice();
    const t = c[1];
    c[1] = c[998];
    c[998] = t;
    data.value = c;
  }
}
function clear() {
  data.value = [];
  selectedId.value = 0;
}
function select(id: number) {
  selectedId.value = id;
}
function remove(id: number) {
  data.value = data.value.filter((x) => x.id !== id);
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run" @click="run(1000)">
                  Create 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="runlots"
                  @click="run(10000)"
                >
                  Create 10,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add" @click="add()">
                  Append 1,000 rows
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="update"
                  @click="update()"
                >
                  Update every 10th row
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear" @click="clear()">
                  Clear
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="swaprows"
                  @click="swapRows()"
                >
                  Swap Rows
                </button>
              </div>
              <button type="button" id="run-10" style="display: none" @click="run(10)">
                Create 10
              </button>
              <button type="button" id="run-100" style="display: none" @click="run(100)">
                Create 100
              </button>
              <button type="button" id="add-10" style="display: none" @click="add(10)">
                Append 10
              </button>
              <button type="button" id="add-100" style="display: none" @click="add(100)">
                Append 100
              </button>
              <button type="button" id="add-10k" style="display: none" @click="add(10000)">
                Append 10000
              </button>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <tr v-for="row in data" :key="row.id" :class="{ danger: row.id === selectedId }">
            <td class="col-md-1">{{ row.id }}</td>
            <td class="col-md-4">
              <a href="#" class="lbl" @click.prevent="select(row.id)">{{ row.label }}</a>
            </td>
            <td class="col-md-1">
              <a href="#" class="remove" @click.prevent="remove(row.id)"
                ><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span
              ></a>
            </td>
            <td class="col-md-6"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
