// Two-way binding benchmark — idiomatic Solid version.
// Uses: createSignal, For, JSX value+onInput. Zero vanilla JS for UI wiring.

import { type Accessor, createSignal, For, type Setter } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Field {
  id: number;
  value: Accessor<string>;
  setValue: Setter<string>;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [fields, setFields] = createSignal<Field[]>([]);
const [result, setResult] = createSignal('—');

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function createFields(count: number) {
  const arr: Field[] = [];
  for (let i = 0; i < count; i++) {
    const [value, setValue] = createSignal('');
    arr.push({ id: i + 1, value, setValue });
  }
  setFields(arr);
  setResult(`Created ${count} fields`);
}

function updateAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) {
    current[i].setValue(`updated-${current[i].id}`);
  }
  setResult(`Updated ${current.length} fields`);
}

function clearAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) {
    current[i].setValue('');
  }
  setResult(`Cleared ${current.length} fields`);
}

function readAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) current[i].value();
  setResult(`Read ${current.length} fields`);
}

// ---------------------------------------------------------------------------
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: any }) {
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
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid (Binding)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="create-100"
                  onClick={() => createFields(100)}
                >
                  Create 100 Fields
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="create-1000"
                  onClick={() => createFields(1000)}
                >
                  Create 1000 Fields
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="update-all"
                  onClick={updateAll}
                >
                  Update All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="clear-all"
                  onClick={clearAll}
                >
                  Clear All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
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
      <div id="result">{result()}</div>
      <div id="container">
        <For each={fields()}>
          {(field: Field) => (
            <div>
              <label for={`field-${field.id}`}>Field {field.id}:</label>
              <input
                id={`field-${field.id}`}
                value={field.value()}
                onInput={(e) => field.setValue(e.currentTarget.value)}
              />
            </div>
          )}
        </For>
      </div>
    </>
  );
}

render(App, document.getElementById('app')!);
