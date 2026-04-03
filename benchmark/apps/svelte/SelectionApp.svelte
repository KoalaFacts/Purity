<script lang="ts">
interface SelectItem { id: number; label: string; selected: boolean; }

let items: SelectItem[] = $state.raw([]);
const selectedCount = $derived(items.filter((i) => i.selected).length);
const allSelected = $derived(items.length > 0 && items.every((i) => i.selected));

function buildItems(n: number): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < n; i++) arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  return arr;
}

function populate(n: number = 1000) { items = buildItems(n); }
function selectAll() { items = items.map((i) => ({ ...i, selected: true })); }
function deselectAll() { items = items.map((i) => ({ ...i, selected: false })); }
function toggleAll() { items = items.map((i) => ({ ...i, selected: !i.selected })); }
function toggleEven() { items = items.map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i)); }
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Selection)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="populate" onclick={() => populate()}>Populate 1k</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="select-all" onclick={selectAll}>Select All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="deselect-all" onclick={deselectAll}>Deselect All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="toggle-all" onclick={toggleAll}>Toggle All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="toggle-even" onclick={toggleEven}>Toggle Even</button></div>
      <button type="button" id="populate-10" style="display:none" onclick={() => populate(10)}>Populate 10</button>
      <button type="button" id="populate-100" style="display:none" onclick={() => populate(100)}>Populate 100</button>
      <button type="button" id="populate-10k" style="display:none" onclick={() => populate(10000)}>Populate 10000</button>
    </div></div>
  </div></div>
  <div id="stats">Selected: <span id="count">{selectedCount}</span> / <span id="total">{items.length}</span> | All: <span id="all-selected">{allSelected ? 'Yes' : 'No'}</span></div>
  <div id="container">
    {#each items as item (item.id)}
      <div>
        <input type="checkbox" checked={item.selected} />
        {item.label}
      </div>
    {/each}
  </div>
</div></div>
