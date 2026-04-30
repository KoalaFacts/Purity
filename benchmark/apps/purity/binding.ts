// Two-way binding benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state } from '@purityjs/core';

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

function ButtonBar() {
  return html`
    <div class="jumbotron">
      <div class="row">
        <div class="col-md-6"><h1>Purity (Binding)</h1></div>
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
            ${hBtn('create-10', 'Create 10', () => createFields(10))}
            ${hBtn('create-10k', 'Create 10k', () => createFields(10000))}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Field list rendering
// ---------------------------------------------------------------------------

const container = document.getElementById('container')!;

const fragment = each(
  () => fields(),
  (field: () => FieldEntry) => {
    const f = field();
    return html`
      <div>
        <label>Field ${String(f.id)}:</label>
        <input ::value=${f.signal} />
      </div>
    ` as unknown as HTMLElement;
  },
  (field: FieldEntry) => field.id,
);
container.appendChild(fragment);

// ---------------------------------------------------------------------------
// Result display
// ---------------------------------------------------------------------------

function Result() {
  return html`<div id="result">${() => resultMsg()}</div>`;
}

mount(Result, document.getElementById('result-container')!);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
