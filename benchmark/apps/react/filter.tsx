// Filter benchmark — idiomatic React version.
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

function App() {
  const [data, setData] = useState<Item[]>([]);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return data;
    return data.filter((item) => item.lowerLabel.includes(q));
  }, [data, query]);

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Filter)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                {/* onInput rather than onChange: the harness assigns .value and dispatches a
                    bare 'input' event; React's onChange value-tracker would suppress that. */}
                <input
                  type="text"
                  id="search"
                  placeholder="Search..."
                  className="form-control"
                  value={query}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onChange={() => {}}
                />
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => setData(buildData(10000))}
                >
                  Populate 10k
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
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
      {createPortal(
        filtered.map((item) => (
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
