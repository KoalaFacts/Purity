// Computed chain benchmark — idiomatic React version.
//
// CAVEAT: React has no fine-grained reactivity. A "chain" of N levels is not N
// reactive nodes; it is one useMemo that walks N steps on every source change,
// followed by a component re-render. This measures recomputation + VDOM diff
// cost, not signal propagation through a dependency graph.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

const MOD = 1_000_000_007;

const resultContainer = document.getElementById('result')!;
// Drop the static placeholder; React renders the placeholder/value via the portal below.
resultContainer.textContent = '';

function App() {
  // levels === 0 means no chain has been set up yet.
  const [levels, setLevels] = useState(0);
  const [source, setSource] = useState(0);

  const value = useMemo(() => {
    if (levels === 0) return null;
    let v = source;
    for (let i = 0; i < levels; i++) v = (v * 2 + 1) % MOD;
    return v;
  }, [levels, source]);

  function setupChain(n: number) {
    setSource(0);
    setLevels(n);
  }

  return (
    <>
      <h1>React — Computed Chain (1000 levels)</h1>
      <button type="button" id="setup" onClick={() => setupChain(1000)}>
        Setup Chain (1000 levels)
      </button>
      <button
        type="button"
        id="update"
        onClick={() => setSource((Math.random() * 100) | 0)}
      >
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
      <button
        type="button"
        id="setup-10"
        style={{ display: 'none' }}
        onClick={() => setupChain(10)}
      >
        Setup 10
      </button>
      <button
        type="button"
        id="setup-100"
        style={{ display: 'none' }}
        onClick={() => setupChain(100)}
      >
        Setup 100
      </button>
      <button
        type="button"
        id="setup-chain"
        style={{ display: 'none' }}
        onClick={() => setupChain(1000)}
      >
        Setup 1000
      </button>
      <button
        type="button"
        id="setup-10k"
        style={{ display: 'none' }}
        onClick={() => setupChain(10000)}
      >
        Setup 10k
      </button>
      {createPortal(value === null ? '—' : <span>{value}</span>, resultContainer)}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
