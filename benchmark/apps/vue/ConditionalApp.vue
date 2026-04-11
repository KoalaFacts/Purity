<script setup lang="ts">
import { ref, shallowRef } from "vue";

interface Item {
  id: number;
  label: string;
}

let nid = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Item ${nid - 1}` };
  return d;
}

const data = shallowRef<Item[]>([]);
const visible = ref(true);

function populate(count = 1000) {
  data.value = buildData(count);
  visible.value = true;
}

defineExpose({ populate });
function toggle() {
  visible.value = !visible.value;
}
function toggle10x() {
  for (let i = 0; i < 10; i++) visible.value = !visible.value;
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue (Conditional)</h1></div>
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
                  id="toggle"
                  @click="toggle()"
                >
                  Toggle Visibility
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-10x"
                  @click="toggle10x()"
                >
                  Toggle 10x
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        <table v-if="visible && data.length > 0" class="table table-hover table-striped test-data">
          <tbody>
            <tr v-for="item in data" :key="item.id">
              <td class="col-md-1">{{ item.id }}</td>
              <td class="col-md-4">{{ item.label }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
