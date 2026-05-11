<script lang="ts">
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

let data: Item[] = $state.raw([]);
let visible: boolean = $state(true);

export function populate(count = 1000) {
  data = buildData(count);
  visible = true;
}
function toggle() {
  visible = !visible;
}
function toggle10x() {
  for (let i = 0; i < 10; i++) visible = !visible;
}
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Conditional)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="populate" onclick={() => populate(1000)}>Populate 1k</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="toggle" onclick={toggle}>Toggle Visibility</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="toggle-10x" onclick={toggle10x}>Toggle 10x</button></div>
      <button type="button" id="populate-10" style="display:none">Populate 10</button>
      <button type="button" id="populate-100" style="display:none">Populate 100</button>
      <button type="button" id="populate-10k" style="display:none">Populate 10k</button>
    </div></div>
  </div></div>
  <div id="container">
    {#if visible && data.length > 0}
      <table class="table table-hover table-striped test-data">
        <tbody>
          {#each data as item (item.id)}
            <tr>
              <td class="col-md-1">{item.id}</td>
              <td class="col-md-4">{item.label}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div></div>
