// Selection benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectItem {
  id: number;
  label: string;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const items = state<SelectItem[]>([]);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const selectedCount = compute(() => items().filter((i) => i.selected).length);
const totalCount = compute(() => items().length);
const allSelected = compute(() => items().length > 0 && items().every((i) => i.selected));

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function buildItems(count: number): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  }
  return arr;
}

function populate(count: number) {
  items(buildItems(count));
}

function selectAll() {
  items(items().map((i) => ({ ...i, selected: true })));
}

function deselectAll() {
  items(items().map((i) => ({ ...i, selected: false })));
}

function toggleAll() {
  items(items().map((i) => ({ ...i, selected: !i.selected })));
}

function toggleEven() {
  items(items().map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i)));
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Selection)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="populate" @click=${() => populate(1000)}>Populate 1k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="select-all" @click=${selectAll}>Select All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="deselect-all" @click=${deselectAll}>Deselect All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="toggle-all" @click=${toggleAll}>Toggle All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="toggle-even" @click=${toggleEven}>Toggle Even</button>
        </div>
        ${hBtn('populate-10', 'Populate 10', () => populate(10))}
        ${hBtn('populate-100', 'Populate 100', () => populate(100))}
        ${hBtn('populate-10k', 'Populate 10k', () => populate(10000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Stats display
// ---------------------------------------------------------------------------

function Stats() {
  return html`
    <div id="stats">
      Selected: <span id="count">${() => String(selectedCount())}</span>
      / <span id="total">${() => String(totalCount())}</span>
      | All: <span id="all-selected">${() => (allSelected() ? 'Yes' : 'No')}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Item list rendering
// ---------------------------------------------------------------------------

const container = document.getElementById('container')!;

const fragment = each(
  () => items(),
  (item: () => SelectItem) =>
    html`
      <div>
        <input type="checkbox" ?checked=${() => item().selected} />
        ${() => item().label}
      </div>
    ` as unknown as HTMLElement,
  (item: SelectItem) => item.id,
);
container.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
mount(Stats, document.getElementById('stats-container')!);
