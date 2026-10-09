// Selection benchmark — idiomatic React version.
// Uses: useState, useMemo, map. Plain React, no signals.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectItem {
  id: number;
  label: string;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function buildItems(count: number): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < count; i++) arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  return arr;
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
  const [items, setItems] = useState<SelectItem[]>([]);

  const selectedCount = useMemo(() => items.filter((i) => i.selected).length, [items]);
  const allSelected = useMemo(
    () => items.length > 0 && items.every((i) => i.selected),
    [items],
  );

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Selection)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => setItems(buildItems(1000))}
                >
                  Populate 1k
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="select-all"
                  onClick={() => setItems((xs) => xs.map((i) => ({ ...i, selected: true })))}
                >
                  Select All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="deselect-all"
                  onClick={() => setItems((xs) => xs.map((i) => ({ ...i, selected: false })))}
                >
                  Deselect All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="toggle-all"
                  onClick={() =>
                    setItems((xs) => xs.map((i) => ({ ...i, selected: !i.selected })))
                  }
                >
                  Toggle All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="toggle-even"
                  onClick={() =>
                    setItems((xs) =>
                      xs.map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i)),
                    )
                  }
                >
                  Toggle Even
                </button>
              </div>
              <HBtn id="populate-10" onClick={() => setItems(buildItems(10))}>
                Populate 10
              </HBtn>
              <HBtn id="populate-100" onClick={() => setItems(buildItems(100))}>
                Populate 100
              </HBtn>
              <HBtn id="populate-10k" onClick={() => setItems(buildItems(10000))}>
                Populate 10k
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="stats">
        Selected: <span id="count">{selectedCount}</span> /{' '}
        <span id="total">{items.length}</span> | All:{' '}
        <span id="all-selected">{allSelected ? 'Yes' : 'No'}</span>
      </div>
      <div id="container">
        {items.map((item) => (
          <div key={item.id}>
            <input type="checkbox" checked={item.selected} readOnly />
            {item.label}
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
