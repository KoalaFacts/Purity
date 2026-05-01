// Filter benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, JSX onClick/onInput. Zero vanilla JS for UI wiring.

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
  lowerLabel: string;
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
  for (let i = 0; i < count; i++) {
    const label = mkLabel();
    d[i] = { id: nextId++, label, lowerLabel: label.toLowerCase() };
  }
  return d;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [data, setData] = createSignal<Item[]>([]);
const [query, setQuery] = createSignal('');

const filtered = createMemo(() => {
  const q = query().toLowerCase();
  if (!q) return data();
  return data().filter((item) => item.lowerLabel.includes(q));
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

function App() {
  return (
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6">
          <h1>Solid (Filter)</h1>
        </div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <input
                type="text"
                id="search"
                placeholder="Search..."
                class="form-control"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="populate"
                onClick={() => setData(buildData(10000))}
              >
                Populate 10k
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="clear-search"
                onClick={() => setQuery('')}
              >
                Clear Search
              </button>
            </div>
            <HBtn id="populate-10" onClick={() => setData(buildData(10))}>
              Populate 10
            </HBtn>
            <HBtn id="populate-100" onClick={() => setData(buildData(100))}>
              Populate 100
            </HBtn>
            <HBtn id="populate-1k" onClick={() => setData(buildData(1000))}>
              Populate 1k
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
    <For each={filtered()}>
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
