// Sort benchmark — idiomatic React version.
// Uses: useState, useMemo, createPortal for <tbody>. Plain React, no signals.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

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
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: string }) {
  return (
    <button type="button" id={props.id} style={{ display: 'none' }} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

type SortMode = 'none' | 'id-asc' | 'id-desc' | 'label-asc';

function App() {
  const [data, setData] = useState<Item[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('none');

  const sorted = useMemo(() => {
    const s = data.slice();
    if (sortMode === 'id-asc') s.sort((a, b) => a.id - b.id);
    else if (sortMode === 'id-desc') s.sort((a, b) => b.id - a.id);
    else if (sortMode === 'label-asc') s.sort((a, b) => a.label.localeCompare(b.label));
    return s;
  }, [data, sortMode]);

  function populate(n: number) {
    setData(buildData(n));
    setSortMode('none');
  }

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Sort)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => populate(1000)}
                >
                  Populate 1k
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="sort-id"
                  onClick={() => setSortMode('id-asc')}
                >
                  Sort by ID ↑
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="sort-id-desc"
                  onClick={() => setSortMode('id-desc')}
                >
                  Sort by ID ↓
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
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
      {createPortal(
        sorted.map((item) => (
          <tr key={item.id}>
            <td className="col-md-1">{item.id}</td>
            <td className="col-md-4">
              <a href="#" className="lbl" aria-label="Item">
                {item.label}
              </a>
            </td>
          </tr>
        )),
        document.getElementById('tbody')!,
      )}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
