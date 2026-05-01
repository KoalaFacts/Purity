<script setup lang="ts">
import { computed, shallowRef } from 'vue';

interface SelectItem {
  id: number;
  label: string;
  selected: boolean;
}

const items = shallowRef<SelectItem[]>([]);
const selectedCount = computed(() => items.value.filter((i) => i.selected).length);
const allSelected = computed(() => items.value.length > 0 && items.value.every((i) => i.selected));

function buildItems(n: number): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  }
  return arr;
}

function populate(n = 1000) {
  items.value = buildItems(n);
}
function selectAll() {
  items.value = items.value.map((i) => ({ ...i, selected: true }));
}
function deselectAll() {
  items.value = items.value.map((i) => ({ ...i, selected: false }));
}
function toggleAll() {
  items.value = items.value.map((i) => ({ ...i, selected: !i.selected }));
}
function toggleEven() {
  items.value = items.value.map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i));
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue (Selection)</h1></div>
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
                  id="select-all"
                  @click="selectAll()"
                >
                  Select All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="deselect-all"
                  @click="deselectAll()"
                >
                  Deselect All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-all"
                  @click="toggleAll()"
                >
                  Toggle All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-even"
                  @click="toggleEven()"
                >
                  Toggle Even
                </button>
              </div>
              <button type="button" id="populate-100" style="display: none" @click="populate(100)">
                Populate 100
              </button>
              <button
                type="button"
                id="populate-10k"
                style="display: none"
                @click="populate(10000)"
              >
                Populate 10000
              </button>
              <button type="button" id="populate-10" style="display: none" @click="populate(10)">
                Populate 10
              </button>
            </div>
          </div>
        </div>
      </div>
      <div id="stats">
        Selected: <span id="count">{{ selectedCount }}</span> /
        <span id="total">{{ items.length }}</span> | All:
        <span id="all-selected">{{ allSelected ? 'Yes' : 'No' }}</span>
      </div>
      <div id="container">
        <div v-for="item in items" :key="item.id">
          <input type="checkbox" :checked="item.selected" />
          {{ item.label }}
        </div>
      </div>
    </div>
  </div>
</template>
