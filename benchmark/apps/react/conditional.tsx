// Conditional rendering benchmark — idiomatic React version.
// Uses: useState, conditional JSX. Plain React, no signals.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

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
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    d[i] = { id, label: `Item ${id}` };
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
  const [visible, setVisible] = useState(true);

  function populate(n: number) {
    setData(buildData(n));
    setVisible(true);
  }

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Conditional)</h1>
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
                  id="toggle"
                  onClick={() => setVisible((v) => !v)}
                >
                  Toggle Visibility
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="toggle-10x"
                  onClick={() => {
                    for (let i = 0; i < 10; i++) setVisible((v) => !v);
                  }}
                >
                  Toggle 10x
                </button>
              </div>
              <HBtn id="populate-10" onClick={() => populate(10)}>
                Populate 10
              </HBtn>
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
      <div id="container">
        {visible && data.length > 0 && (
          <table className="table table-hover table-striped test-data">
            <tbody>
              {data.map((item) => (
                <tr key={item.id}>
                  <td className="col-md-1">{item.id}</td>
                  <td className="col-md-4">{item.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
