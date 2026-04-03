<script lang="ts">
interface Field { id: number; value: string; }

let fields: Field[] = $state([]);
let result: string = $state('—');

function createFields(count: number) {
  const arr: Field[] = [];
  for (let i = 0; i < count; i++) arr.push({ id: i + 1, value: '' });
  fields = arr;
  result = `Created ${count} fields`;
}

function updateAll() {
  for (let i = 0; i < fields.length; i++) fields[i].value = `updated-${fields[i].id}`;
  result = `Updated ${fields.length} fields`;
}

function clearAll() {
  for (let i = 0; i < fields.length; i++) fields[i].value = '';
  result = `Cleared ${fields.length} fields`;
}

function readAll() {
  let count = 0;
  for (let i = 0; i < fields.length; i++) { void fields[i].value; count++; }
  result = `Read ${count} fields`;
}
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Binding)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-100" onclick={() => createFields(100)}>Create 100 Fields</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-1000" onclick={() => createFields(1000)}>Create 1000 Fields</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update-all" onclick={updateAll}>Update All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear-all" onclick={clearAll}>Clear All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="read-all" onclick={readAll}>Read All</button></div>
      <button type="button" id="create-10" style="display:none" onclick={() => createFields(10)}>Create 10 Fields</button>
      <button type="button" id="create-10k" style="display:none" onclick={() => createFields(10000)}>Create 10000 Fields</button>
    </div></div>
  </div></div>
  <div id="result">{result}</div>
  <div id="container">
    {#each fields as field (field.id)}
      <div>
        <label>Field {field.id}:</label>
        <input bind:value={field.value} />
      </div>
    {/each}
  </div>
</div></div>
