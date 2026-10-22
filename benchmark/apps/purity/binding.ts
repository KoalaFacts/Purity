// Two-way binding benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, mount, state } from '@purityjs/core';
import { html } from '@purityjs/core/jit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StateAccessor<T> = ReturnType<typeof state<T>>;

interface FieldEntry {
  id: number;
  signal: StateAccessor<string>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const fields = state<FieldEntry[]>([]);
const resultMsg = state('—');

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function createFields(count: number) {
  const arr: FieldEntry[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: i + 1, signal: state('') });
  }
  fields(arr);
  resultMsg(`Created ${count} fields`);
}

function updateAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) {
    current[i].signal(`updated-${current[i].id}`);
  }
  resultMsg(`Updated ${current.length} fields`);
}

function clearAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) {
    current[i].signal('');
  }
  resultMsg(`Cleared ${current.length} fields`);
}

function readAll() {
  const current = fields();
  for (let i = 0; i < current.length; i++) {
    current[i].signal();
  }
  resultMsg(`Read ${current.length} fields`);
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>
    ${label}
  </button>`;
}

function App() {
  return html`
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6"><h1>Two-way binding</h1></div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="create-100"
                @click=${() => createFields(100)}
              >
                Create 100 Fields
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="create-1000"
                @click=${() => createFields(1000)}
              >
                Create 1000 Fields
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="update-all"
                @click=${updateAll}
              >
                Update All
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="clear-all"
                @click=${clearAll}
              >
                Clear All
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="read-all"
                @click=${readAll}
              >
                Read All
              </button>
            </div>
            ${hBtn('create-10', 'Create 10 Fields', () => createFields(10))}
            ${hBtn('create-10k', 'Create 10,000 Fields', () => createFields(10000))}
          </div>
        </div>
      </div>
    </div>
    <div id="result-container"><div id="result">${() => resultMsg()}</div></div>
    <div id="container">${FieldList()}</div>
  `;
}

// ---------------------------------------------------------------------------
// Field list rendering
// ---------------------------------------------------------------------------

function FieldList() {
  return each(
    () => fields(),
    (field: () => FieldEntry) => {
      const f = field();
      return html`
      <div>
        <label for=${`field-${f.id}`}>Field ${String(f.id)}:</label>
        <input id=${`field-${f.id}`} ::value=${f.signal} />
      </div>
    ` as unknown as HTMLElement;
    },
    // Each Create action owns fresh signals, even when numeric IDs repeat.
    // Match Solid's object-keyed For so inputs bind to the new field objects.
    (field: FieldEntry) => field,
  );
}

mount(App, document.getElementById('app')!);
