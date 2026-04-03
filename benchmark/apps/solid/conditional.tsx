// Conditional rendering benchmark — idiomatic Solid version.
// Uses: createSignal, For, Show, JSX onClick. Zero vanilla JS for UI wiring.

import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Types and data generation
// ---------------------------------------------------------------------------

interface Item {
  id: number;
  label: string;
}

let nextId = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Item ${nextId - 1}` };
  return d;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [data, setData] = createSignal<Item[]>([]);
const [visible, setVisible] = createSignal(true);

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid (Conditional)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => {
                    setData(buildData(1000));
                    setVisible(true);
                  }}
                >
                  Populate 1k
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle"
                  onClick={() => setVisible((v) => !v)}
                >
                  Toggle Visibility
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-10x"
                  onClick={() => {
                    for (let i = 0; i < 10; i++) setVisible((v) => !v);
                  }}
                >
                  Toggle 10x
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        <Show when={visible() && data().length > 0}>
          <table class="table table-hover table-striped test-data">
            <tbody>
              <For each={data()}>
                {(item: Item) => (
                  <tr>
                    <td class="col-md-1">{item.id}</td>
                    <td class="col-md-4">{item.label}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </>
  );
}

render(App, document.getElementById('app')!);

// Hidden button handlers for benchmark permutations
function populate(n: number) {
  setData(buildData(n));
  setVisible(true);
}
document.getElementById('populate-10')?.addEventListener('click', () => populate(10));
document.getElementById('populate-100')?.addEventListener('click', () => populate(100));
document.getElementById('populate-10k')?.addEventListener('click', () => populate(10000));
