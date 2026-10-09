// Diamond dependency benchmark — idiomatic React version.
//
// CAVEAT: React has no fine-grained reactivity. Each "diamond" (a -> b, a -> c,
// b + c -> d) is computed from a plain array of source values inside one useMemo,
// and updates re-render the component. This measures recomputation + VDOM diff
// cost, not signal-graph propagation.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

const resultContainer = document.getElementById('result')!;
// Drop the static placeholder; React renders the placeholder/value via the portal below.
resultContainer.textContent = '';

function App() {
  // Empty until a setup button runs.
  const [sources, setSources] = useState<number[] | null>(null);

  // Each diamond: a = source, b = 2a, c = 3a, d = b + c = 5a. Total = sum of d.
  const total = useMemo(() => {
    if (sources === null) return null;
    let s = 0;
    for (let i = 0; i < sources.length; i++) s += sources[i] * 5;
    return s;
  }, [sources]);

  function setupDiamond(count: number) {
    setSources(Array.from({ length: count }, (_, i) => i));
  }

  return (
    <>
      <h1>React — Diamond Dependency (1000 patterns)</h1>
      <button type="button" id="setup" onClick={() => setupDiamond(1000)}>
        Setup 1000 Diamonds
      </button>
      <button
        type="button"
        id="update-all"
        onClick={() => {
          setSources((prev) => {
            if (prev === null) return prev;
            return prev.map((_, i) => i + ((i * 17 + 23) % 100));
          });
        }}
      >
        Update All Sources
      </button>
      <button
        type="button"
        id="update-one"
        onClick={() => {
          setSources((prev) => {
            if (prev === null || prev.length === 0) return prev;
            const next = prev.slice();
            next[0] = 23;
            return next;
          });
        }}
      >
        Update One Source
      </button>
      <button
        type="button"
        id="setup-10"
        style={{ display: 'none' }}
        onClick={() => setupDiamond(10)}
      >
        Setup 10
      </button>
      <button
        type="button"
        id="setup-100"
        style={{ display: 'none' }}
        onClick={() => setupDiamond(100)}
      >
        Setup 100
      </button>
      <button
        type="button"
        id="setup-diamonds"
        style={{ display: 'none' }}
        onClick={() => setupDiamond(1000)}
      >
        Setup 1000
      </button>
      <button
        type="button"
        id="setup-10k"
        style={{ display: 'none' }}
        onClick={() => setupDiamond(10000)}
      >
        Setup 10k
      </button>
      {createPortal(total === null ? '—' : <span>{total}</span>, resultContainer)}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
