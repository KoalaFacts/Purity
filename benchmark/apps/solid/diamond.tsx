// Diamond dependency benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, batch, JSX onClick. Zero vanilla JS for UI wiring.

import { type Accessor, batch, createMemo, createSignal, type Setter } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Module-level state for diamond setup/teardown
// ---------------------------------------------------------------------------

let sources: Setter<number>[] = [];
let disposeGraph: (() => void) | null = null;

const resultContainer = document.getElementById('result')!;

function setupDiamonds() {
  if (disposeGraph) disposeGraph();
  resultContainer.textContent = '';
  disposeGraph = render(() => {
    sources = [];
    const results: Accessor<number>[] = [];
    for (let i = 0; i < 1000; i++) {
      const [a, setA] = createSignal(i);
      const b = createMemo(() => a() * 2);
      const c = createMemo(() => a() * 3);
      const d = createMemo(() => b() + c());
      sources.push(setA);
      results.push(d);
    }
    const total = createMemo(() => {
      let s = 0;
      for (let i = 0; i < results.length; i++) s += results[i]();
      return s;
    });
    return <span>{total()}</span>;
  }, resultContainer);
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <h1>Solid — Diamond Dependency (1000 patterns)</h1>
      <button type="button" id="setup" onClick={setupDiamonds}>
        Setup 1000 Diamonds
      </button>
      <button
        type="button"
        id="update-all"
        onClick={() => {
          batch(() => {
            for (let i = 0; i < sources.length; i++) {
              sources[i](i + ((Math.random() * 100) | 0));
            }
          });
        }}
      >
        Update All Sources
      </button>
      <button
        type="button"
        id="update-one"
        onClick={() => {
          if (sources.length) sources[0]((Math.random() * 100) | 0);
        }}
      >
        Update One Source
      </button>
    </>
  );
}

render(App, document.getElementById('app')!);
