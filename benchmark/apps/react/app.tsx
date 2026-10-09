// Row rendering benchmark — idiomatic React version.
// Uses: useState, useMemo-free data flow, createPortal for the <tbody> outside #app.
// Plain React: no signals library. Updates re-render through the VDOM diff.

import { useState } from 'react';
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

let nid = 1;
let seed = 1;
const rnd = (m: number) => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed % m;
};
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

interface Row {
  id: number;
  label: string;
}

function mkData(n: number): Row[] {
  const d = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    d[i] = { id: nid++, label: mkLabel() };
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
  const [data, setData] = useState<Row[]>([]);
  const [selectedId, setSelectedId] = useState(0);

  function run(n: number) {
    setData(mkData(n));
    setSelectedId(0);
  }

  function add(n: number) {
    setData((d) => d.concat(mkData(n)));
  }

  function update() {
    setData((d) => d.map((r, i) => (i % 10 === 0 ? { id: r.id, label: `${r.label} !!!` } : r)));
  }

  function swapRows() {
    setData((d) => {
      if (d.length > 998) {
        const c = d.slice();
        const t = c[1];
        c[1] = c[998];
        c[998] = t;
        return c;
      }
      return d;
    });
  }

  function remove(id: number) {
    setData((d) => d.filter((r) => r.id !== id));
  }

  function clear() {
    setData([]);
    setSelectedId(0);
  }

  const tbody = document.getElementById('tbody')!;

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="run"
                  onClick={() => run(1000)}
                >
                  Create 1,000 rows
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="runlots"
                  onClick={() => run(10000)}
                >
                  Create 10,000 rows
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="add"
                  onClick={() => add(1000)}
                >
                  Append 1,000 rows
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="update"
                  onClick={update}
                >
                  Update every 10th row
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="clear"
                  onClick={clear}
                >
                  Clear
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="swaprows"
                  onClick={swapRows}
                >
                  Swap Rows
                </button>
              </div>
              <HBtn id="run-10" onClick={() => run(10)}>
                Create 10
              </HBtn>
              <HBtn id="run-100" onClick={() => run(100)}>
                Create 100
              </HBtn>
              <HBtn id="run-1k" onClick={() => run(1000)}>
                Create 1k
              </HBtn>
              <HBtn id="run-10k" onClick={() => run(10000)}>
                Create 10k
              </HBtn>
              <HBtn id="add-10" onClick={() => add(10)}>
                Append 10
              </HBtn>
              <HBtn id="add-100" onClick={() => add(100)}>
                Append 100
              </HBtn>
              <HBtn id="add-1k" onClick={() => add(1000)}>
                Append 1k
              </HBtn>
              <HBtn id="add-10k" onClick={() => add(10000)}>
                Append 10,000
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      {createPortal(
        data.map((row) => (
          <tr key={row.id} className={row.id === selectedId ? 'danger' : ''}>
            <td className="col-md-1">{row.id}</td>
            <td className="col-md-4">
              <a
                href="#"
                className="lbl"
                aria-label="Select row"
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedId(row.id);
                }}
              >
                {row.label}
              </a>
            </td>
            <td className="col-md-1">
              <a
                href="#"
                className="remove"
                aria-label="Remove row"
                onClick={(e) => {
                  e.preventDefault();
                  remove(row.id);
                }}
              >
                <span className="remove glyphicon glyphicon-remove" aria-hidden="true"></span>
              </a>
            </td>
            <td className="col-md-6"></td>
          </tr>
        )),
        tbody,
      )}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
