// Two-way binding benchmark — idiomatic React version.
// Uses: useState, controlled inputs (value + onChange). Plain React, no signals.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Field {
  id: number;
  value: string;
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

function makeFields(count: number): Field[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, value: '' }));
}

function App() {
  const [fields, setFields] = useState<Field[]>([]);
  const [result, setResult] = useState('—');

  function createFields(count: number) {
    setFields(makeFields(count));
    setResult(`Created ${count} fields`);
  }

  function updateAll() {
    setFields((fs) => fs.map((f) => ({ id: f.id, value: `updated-${f.id}` })));
    setResult(`Updated ${fields.length} fields`);
  }

  function clearAll() {
    setFields((fs) => fs.map((f) => ({ id: f.id, value: '' })));
    setResult(`Cleared ${fields.length} fields`);
  }

  function readAll() {
    setResult(`Read ${fields.length} fields`);
  }

  function setFieldValue(id: number, value: string) {
    setFields((fs) => fs.map((f) => (f.id === id ? { id: f.id, value } : f)));
  }

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Binding)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="create-100"
                  onClick={() => createFields(100)}
                >
                  Create 100 Fields
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="create-1000"
                  onClick={() => createFields(1000)}
                >
                  Create 1000 Fields
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="update-all"
                  onClick={updateAll}
                >
                  Update All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="clear-all"
                  onClick={clearAll}
                >
                  Clear All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="read-all"
                  onClick={readAll}
                >
                  Read All
                </button>
              </div>
              <HBtn id="create-10" onClick={() => createFields(10)}>
                Create 10 Fields
              </HBtn>
              <HBtn id="create-10k" onClick={() => createFields(10000)}>
                Create 10,000 Fields
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="result">{result}</div>
      <div id="container">
        {fields.map((field) => (
          <div key={field.id}>
            <label htmlFor={`field-${field.id}`}>Field {field.id}:</label>
            <input
              id={`field-${field.id}`}
              value={field.value}
              onChange={(e) => setFieldValue(field.id, e.currentTarget.value)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
