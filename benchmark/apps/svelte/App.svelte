<script lang="ts">
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

let data: RowItem[] = $state.raw([]);
let selectedId: number = $state(0);

function run(count: number) {
  data = mkData(count);
  selectedId = 0;
}
function add(count: number = 1000) {
  data = data.concat(mkData(count));
}
function update() {
  const c = data.slice();
  for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
  data = c;
}
function select(id: number) {
  selectedId = id;
}
function swapRows() {
  if (data.length > 998) {
    const c = data.slice();
    const t = c[1];
    c[1] = c[998];
    c[998] = t;
    data = c;
  }
}
function remove(id: number) {
  data = data.filter((x) => x.id !== id);
}
function clear() {
  data = [];
  selectedId = 0;
}

function handleClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
  if (a.classList.contains('lbl')) select(id);
  else if (a.classList.contains('remove')) remove(id);
}
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run" onclick={() => run(1000)}>Create 1,000 rows</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots" onclick={() => run(10000)}>Create 10,000 rows</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add" onclick={() => add()}>Append 1,000 rows</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update" onclick={update}>Update every 10th row</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear" onclick={clear}>Clear</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows" onclick={swapRows}>Swap Rows</button></div>
      <button type="button" id="run-10" style="display:none" onclick={() => run(10)}>Create 10</button>
      <button type="button" id="run-100" style="display:none" onclick={() => run(100)}>Create 100</button>
      <button type="button" id="add-10" style="display:none" onclick={() => add(10)}>Append 10</button>
      <button type="button" id="add-100" style="display:none" onclick={() => add(100)}>Append 100</button>
      <button type="button" id="add-10k" style="display:none" onclick={() => add(10000)}>Append 10000</button>
    </div></div>
  </div></div>
  <table class="table table-hover table-striped test-data">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <tbody onclick={handleClick} onkeydown={(e) => { if (e.key === 'Enter') handleClick(e as unknown as MouseEvent); }}>
      {#each data as row (row.id)}
        <tr class:danger={row.id === selectedId}>
          <td class="col-md-1">{row.id}</td>
          <!-- svelte-ignore a11y_invalid_attribute -->
          <td class="col-md-4"><a href="#" class="lbl">{row.label}</a></td>
          <!-- svelte-ignore a11y_invalid_attribute -->
          <td class="col-md-1"><a href="#" class="remove" aria-label="Remove"><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div></div>
