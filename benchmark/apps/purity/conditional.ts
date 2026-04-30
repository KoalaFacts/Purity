// Conditional rendering benchmark — Purity idiomatic version.
// Uses: state, each, html, mount, when. Zero vanilla JS for UI wiring.

import { each, html, mount, state, when } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Item {
  id: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

let nextId = 1;

function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Item ${nextId - 1}` };
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = state<Item[]>([]);
const visible = state(true);

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Conditional)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="populate" @click=${() => {
            data(buildData(1000));
            visible(true);
          }}>Populate 1k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="toggle" @click=${() => visible(!visible())}>Toggle Visibility</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="toggle-10x" @click=${() => {
            for (let i = 0; i < 10; i++) visible(!visible());
          }}>Toggle 10x</button>
        </div>
        ${hBtn('populate-10', 'Populate 10', () => {
          data(buildData(10));
          visible(true);
        })}
        ${hBtn('populate-100', 'Populate 100', () => {
          data(buildData(100));
          visible(true);
        })}
        ${hBtn('populate-10k', 'Populate 10k', () => {
          data(buildData(10000));
          visible(true);
        })}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Conditional list rendering
// ---------------------------------------------------------------------------

const container = document.getElementById('container')!;

const fragment = when(
  () => visible() && data().length > 0,
  () => {
    const table =
      html`<table class="table table-hover table-striped test-data"><tbody></tbody></table>` as unknown as HTMLTableElement;
    const tbody = table.querySelector('tbody')!;
    const rows = each(
      () => data(),
      (item: () => Item) => {
        const r = item();
        return html`
          <tr>
            <td class="col-md-1">${String(r.id)}</td>
            <td class="col-md-4">${r.label}</td>
          </tr>
        ` as unknown as HTMLTableRowElement;
      },
      (item: Item) => item.id,
    );
    tbody.appendChild(rows);
    return table;
  },
);
container.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
