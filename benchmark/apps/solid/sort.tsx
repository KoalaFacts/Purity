// Sort benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createMemo, createSignal, For } from 'solid-js';
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

interface Item {
  id: number;
  label: string;
}

let nextId = 1;
let seed = 1;
const rnd = (m: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % m;
};
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

function buildData(count: number): Item[] {
  const d = new Array<Item>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: mkLabel() };
  return d;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

type SortMode = 'none' | 'id-asc' | 'id-desc' | 'label-asc';

const [data, setData] = createSignal<Item[]>([]);
const [sortMode, setSortMode] = createSignal<SortMode>('none');

const sorted = createMemo(() => {
  const s = data().slice();
  const mode = sortMode();
  if (mode === 'id-asc') s.sort((a, b) => a.id - b.id);
  else if (mode === 'id-desc') s.sort((a, b) => b.id - a.id);
  else if (mode === 'label-asc') s.sort((a, b) => a.label.localeCompare(b.label));
  return s;
});

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

function populate(n: number) {
  setData(buildData(n));
  setSortMode('none');
}

function App() {
  return (
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6">
          <h1>Solid (Sort)</h1>
        </div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="populate"
                onClick={() => populate(1000)}
              >
                Populate 1k
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="sort-id"
                onClick={() => setSortMode('id-asc')}
              >
                Sort by ID ↑
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="sort-id-desc"
                onClick={() => setSortMode('id-desc')}
              >
                Sort by ID ↓
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="sort-label"
                onClick={() => setSortMode('label-asc')}
              >
                Sort by Label ↑
              </button>
            </div>
            <HBtn id="populate-100" onClick={() => populate(100)}>
              Populate 100
            </HBtn>
            <HBtn id="populate-10k" onClick={() => populate(10000)}>
              Populate 10k
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
    <For each={sorted()}>
      {(item: Item) => (
        <tr>
          <td class="col-md-1">{item.id}</td>
          <td class="col-md-4">
            <a href="#" class="lbl" aria-label="Item">
              {item.label}
            </a>
          </td>
        </tr>
      )}
    </For>
  ),
  document.getElementById('tbody')!,
);

render(App, document.getElementById('app')!);
