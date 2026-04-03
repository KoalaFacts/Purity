<script lang="ts">
const A = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint',
  'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly',
  'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy',
];
const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const N = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

interface Item { id: number; label: string; }

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: mkLabel() };
  return d;
}

type SortMode = 'none' | 'id-asc' | 'id-desc' | 'label-asc';

let data: Item[] = $state.raw([]);
let sortMode: SortMode = $state('none');

const sorted: Item[] = $derived.by(() => {
  const s = data.slice();
  if (sortMode === 'id-asc') s.sort((a, b) => a.id - b.id);
  else if (sortMode === 'id-desc') s.sort((a, b) => b.id - a.id);
  else if (sortMode === 'label-asc') s.sort((a, b) => a.label.localeCompare(b.label));
  return s;
});

function populate(n: number = 1000) { data = buildData(n); sortMode = 'none'; }
function sortIdAsc() { sortMode = 'id-asc'; }
function sortIdDesc() { sortMode = 'id-desc'; }
function sortLabelAsc() { sortMode = 'label-asc'; }
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Sort)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="populate" onclick={() => populate()}>Populate 1k</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="sort-id" onclick={sortIdAsc}>Sort by ID ↑</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="sort-id-desc" onclick={sortIdDesc}>Sort by ID ↓</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="sort-label" onclick={sortLabelAsc}>Sort by Label ↑</button></div>
      <button type="button" id="populate-100" style="display:none" onclick={() => populate(100)}>Populate 100</button>
      <button type="button" id="populate-10k" style="display:none" onclick={() => populate(10000)}>Populate 10000</button>
    </div></div>
  </div></div>
  <table class="table table-hover table-striped test-data">
    <tbody>
      {#each sorted as item (item.id)}
        <tr>
          <td class="col-md-1">{item.id}</td>
          <td class="col-md-4"><a href="#" class="lbl">{item.label}</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div></div>
