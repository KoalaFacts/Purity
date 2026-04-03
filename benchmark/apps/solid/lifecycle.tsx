// Lifecycle benchmark — idiomatic Solid version.
// Uses: createSignal, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Types and data generation
// ---------------------------------------------------------------------------

interface Card {
  id: number;
  label: string;
}

let nextId = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Card ${nextId - 1}` };
  return d;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [cards, setCards] = createSignal<Card[]>([]);

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
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid (Lifecycle)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="create-1k"
                  onClick={() => setCards(buildCards(1000))}
                >
                  Create 1k
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="create-10k"
                  onClick={() => setCards(buildCards(10000))}
                >
                  Create 10k
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="destroy-all"
                  onClick={() => setCards([])}
                >
                  Destroy All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="replace"
                  onClick={() => setCards(buildCards(1000))}
                >
                  Replace 1k
                </button>
              </div>
              <HBtn id="create-10" onClick={() => setCards(buildCards(10))}>
                Create 10
              </HBtn>
              <HBtn id="create-100" onClick={() => setCards(buildCards(100))}>
                Create 100
              </HBtn>
              <HBtn id="replace-10" onClick={() => setCards(buildCards(10))}>
                Replace 10
              </HBtn>
              <HBtn id="replace-100" onClick={() => setCards(buildCards(100))}>
                Replace 100
              </HBtn>
              <HBtn id="replace-10k" onClick={() => setCards(buildCards(10000))}>
                Replace 10,000
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        <For each={cards()}>
          {(card: Card) => (
            <div class="card">
              <span class="id">{card.id}</span>
              <span class="label">{card.label}</span>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

render(App, document.getElementById('app')!);
