// Computed chain benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, JSX onClick. Zero vanilla JS for UI wiring.

import { type Accessor, createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";

// ---------------------------------------------------------------------------
// Module-level state for chain setup/teardown
// ---------------------------------------------------------------------------

let setSource: (v: number) => void = () => {};
let disposeChain: (() => void) | null = null;

const resultContainer = document.getElementById("result")!;

function setupChain(levels: number) {
  if (disposeChain) disposeChain();
  resultContainer.textContent = "";
  disposeChain = render(() => {
    const [source, _setSource] = createSignal(0);
    setSource = _setSource;
    const chain: Accessor<number>[] = [];
    let prev: Accessor<number> = source;
    for (let i = 0; i < levels; i++) {
      const p = prev;
      const c = createMemo(() => p() * 2 + 1);
      chain.push(c);
      prev = c;
    }
    const last = chain[chain.length - 1];
    return <span>{last()}</span>;
  }, resultContainer);
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <h1>Solid — Computed Chain (1000 levels)</h1>
      <button type="button" id="setup" onClick={() => setupChain(1000)}>
        Setup Chain (1000 levels)
      </button>
      <button type="button" id="update" onClick={() => setSource((Math.random() * 100) | 0)}>
        Update Source
      </button>
      <button
        type="button"
        id="update-10x"
        onClick={() => {
          for (let i = 0; i < 10; i++) setSource((Math.random() * 100) | 0);
        }}
      >
        Update 10x
      </button>
    </>
  );
}

render(App, document.getElementById("app")!);

// Hidden button handlers for benchmark permutations
document.getElementById("setup-10")?.addEventListener("click", () => setupChain(10));
document.getElementById("setup-100")?.addEventListener("click", () => setupChain(100));
document.getElementById("setup-10k")?.addEventListener("click", () => setupChain(10000));
