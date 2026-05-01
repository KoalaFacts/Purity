// Row rendering benchmark — idiomatic Solid version.
// Uses: createSignal, For, batch, JSX onClick. Zero vanilla JS for UI wiring.

import { type Accessor, batch, createSignal, For, type Setter } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

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

let nid = 1;
let seed = 1;
const rnd = (m: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % m;
};
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

interface Row {
  id: number;
  label: Accessor<string>;
  setLabel: Setter<string>;
}

function mkData(n: number): Row[] {
  const d = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const [label, setLabel] = createSignal(mkLabel());
    d[i] = { id: nid++, label, setLabel };
  }
  return d;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [data, setData] = createSignal<Row[]>([]);
const [selectedId, setSelectedId] = createSignal(0);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function run(n: number) {
  batch(() => {
    setData(mkData(n));
    setSelectedId(0);
  });
}

function add(n: number) {
  setData((d) => d.concat(mkData(n)));
}

function update() {
  const d = data();
  for (let i = 0; i < d.length; i += 10) {
    d[i].setLabel((l) => `${l} !!!`);
  }
}

function swapRows() {
  setData((d) => {
    if (d.length > 998) {
      const c = d.slice();
      const t = c[1];
      c[1] = c[998];
      c[998] = t;
      return c;
    }
    return d;
  });
}

function remove(id: number) {
  setData((d) => d.filter((r) => r.id !== id));
}

function clear() {
  batch(() => {
    setData([]);
    setSelectedId(0);
  });
}

// ---------------------------------------------------------------------------
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: any }) {
  return (
    <button type="button" id={props.id} style={{ display: 'none' }} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const tbody = document.getElementById('tbody')!;

  // Event delegation — one listener for all rows (standard benchmark pattern)
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) setSelectedId(id);
    else if (a.classList.contains('remove')) remove(id);
  });

  return (
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6">
          <h1>Solid</h1>
        </div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="run"
                onClick={() => run(1000)}
              >
                Create 1,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="runlots"
                onClick={() => run(10000)}
              >
                Create 10,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="add"
                onClick={() => add(1000)}
              >
                Append 1,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="update" onClick={update}>
                Update every 10th row
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="clear" onClick={clear}>
                Clear
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="swaprows"
                onClick={swapRows}
              >
                Swap Rows
              </button>
            </div>
            <HBtn id="run-10" onClick={() => run(10)}>
              Create 10
            </HBtn>
            <HBtn id="run-100" onClick={() => run(100)}>
              Create 100
            </HBtn>
            <HBtn id="run-1k" onClick={() => run(1000)}>
              Create 1k
            </HBtn>
            <HBtn id="run-10k" onClick={() => run(10000)}>
              Create 10k
            </HBtn>
            <HBtn id="add-10" onClick={() => add(10)}>
              Append 10
            </HBtn>
            <HBtn id="add-100" onClick={() => add(100)}>
              Append 100
            </HBtn>
            <HBtn id="add-1k" onClick={() => add(1000)}>
              Append 1k
            </HBtn>
            <HBtn id="add-10k" onClick={() => add(10000)}>
              Append 10,000
            </HBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row rendering — rendered into tbody via separate render call
// ---------------------------------------------------------------------------

render(
  () => (
    <For each={data()}>
      {(row: Row) => (
        <tr class={row.id === selectedId() ? 'danger' : ''}>
          <td class="col-md-1">{row.id}</td>
          <td class="col-md-4">
            <a href="#" class="lbl" aria-label="Select row">
              {row.label()}
            </a>
          </td>
          <td class="col-md-1">
            <a href="#" class="remove" aria-label="Remove row">
              <span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span>
            </a>
          </td>
          <td class="col-md-6"></td>
        </tr>
      )}
    </For>
  ),
  document.getElementById('tbody')!,
);

render(App, document.getElementById('app')!);
