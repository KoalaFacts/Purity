<script lang="ts">
interface Card { id: number; label: string; }

let nid = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Card ${nid - 1}` };
  return d;
}

let cards: Card[] = $state.raw([]);

function create(n: number) { cards = buildCards(n); }
function destroyAll() { cards = []; }
function replace(n: number = 1000) { cards = buildCards(n); }
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Lifecycle)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-1k" onclick={() => create(1000)}>Create 1k</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="create-10k" onclick={() => create(10000)}>Create 10k</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="destroy-all" onclick={destroyAll}>Destroy All</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="replace" onclick={() => replace()}>Replace 1k</button></div>
      <button type="button" id="create-10" style="display:none" onclick={() => create(10)}>Create 10</button>
      <button type="button" id="create-100" style="display:none" onclick={() => create(100)}>Create 100</button>
      <button type="button" id="replace-10" style="display:none" onclick={() => replace(10)}>Replace 10</button>
      <button type="button" id="replace-100" style="display:none" onclick={() => replace(100)}>Replace 100</button>
      <button type="button" id="replace-10k" style="display:none" onclick={() => replace(10000)}>Replace 10000</button>
    </div></div>
  </div></div>
  <div id="container">
    {#each cards as card (card.id)}
      <div class="card"><span class="id">{card.id}</span><span class="label">{card.label}</span></div>
    {/each}
  </div>
</div></div>
