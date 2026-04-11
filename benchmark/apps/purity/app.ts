// Row rendering benchmark — Purity idiomatic version.
// Uses: state, watch, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state, watch } from "@purityjs/core";

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

const adjectives = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
  "clean",
  "elegant",
  "easy",
  "angry",
  "crazy",
  "helpful",
  "mushy",
  "odd",
  "unsightly",
  "adorable",
  "important",
  "inexpensive",
  "cheap",
  "expensive",
  "fancy",
];
const colours = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "brown",
  "white",
  "black",
  "orange",
];
const nouns = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
  "pizza",
  "mouse",
  "keyboard",
];

interface Row {
  id: number;
  label: string;
}

interface CachedRow {
  tr: HTMLTableRowElement;
  labelNode: Text;
  label: string;
}

let nextId = 1;
const random = (max: number) => (Math.random() * max) | 0;
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): Row[] {
  const d = new Array<Row>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const data = state<Row[]>([]);
const selectedId = state(0);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function run(n: number) {
  data(buildData(n));
  selectedId(0);
}

function add(n: number) {
  data((d) => d.concat(buildData(n)));
}

function update() {
  data((d) => {
    const c = d.slice();
    for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
    return c;
  });
}

function clear() {
  rows.clear();
  data([]);
  selectedId(0);
}

function swapRows() {
  data((d) => {
    if (d.length > 998) {
      const c = d.slice();
      const tmp = c[1];
      c[1] = c[998];
      c[998] = tmp;
      return c;
    }
    return d;
  });
}

function select(id: number) {
  selectedId(id);
}

function remove(id: number) {
  rows.delete(id);
  data((d) => d.filter((item) => item.id !== id));
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
        <div class="col-md-6"><h1>Purity</h1></div>
        <div class="col-md-6">
          <div class="row">
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="run"
                @click=${() => run(1000)}
              >
                Create 1,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="runlots"
                @click=${() => run(10000)}
              >
                Create 10,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="add"
                @click=${() => add(1000)}
              >
                Append 1,000 rows
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="update" @click=${update}>
                Update every 10th row
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button type="button" class="btn btn-primary btn-block" id="clear" @click=${clear}>
                Clear
              </button>
            </div>
            <div class="col-sm-6 smallpad">
              <button
                type="button"
                class="btn btn-primary btn-block"
                id="swaprows"
                @click=${swapRows}
              >
                Swap Rows
              </button>
            </div>
            ${hBtn("run-10", "Create 10", () => run(10))}
            ${hBtn("run-100", "Create 100", () => run(100))}
            ${hBtn("run-1k", "Create 1k", () => run(1000))}
            ${hBtn("run-10k", "Create 10k", () => run(10000))}
            ${hBtn("add-10", "Add 10", () => add(10))} ${hBtn("add-100", "Add 100", () => add(100))}
            ${hBtn("add-1k", "Add 1k", () => add(1000))}
            ${hBtn("add-10k", "Add 10k", () => add(10000))}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const rows = new Map<number, CachedRow>();

const tbody = document.getElementById("tbody")!;

// Keyed list via each() — LIS reconciliation
const fragment = each(
  () => data(),
  (item: Row) => {
    const tr = html`
      <tr>
        <td class="col-md-1">${String(item.id)}</td>
        <td class="col-md-4"><a href="#" class="lbl">${item.label}</a></td>
        <td class="col-md-1">
          <a href="#" class="remove"
            ><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span
          ></a>
        </td>
        <td class="col-md-6"></td>
      </tr>
    ` as unknown as HTMLTableRowElement;

    const labelNode = tr.querySelector(".lbl")!.firstChild as Text;
    rows.set(item.id, { tr, labelNode, label: item.label });
    return tr;
  },
  (item: Row) => item.id,
);
tbody.appendChild(fragment);

// In-place label updates — avoids DOM churn for partial updates
watch(data, (list) => {
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const row = rows.get(item.id);
    if (row && row.label !== item.label) {
      row.labelNode.data = item.label;
      row.label = item.label;
    }
  }
});

// Selection highlighting
watch(selectedId, (id, oldId) => {
  if (oldId) {
    const r = rows.get(oldId);
    if (r) r.tr.className = "";
  }
  if (id) {
    const r = rows.get(id);
    if (r) r.tr.className = "danger";
  }
});

// Event delegation — one listener for all rows (standard benchmark pattern)
tbody.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const id = +(a.closest("tr")!.firstChild as HTMLElement).textContent!;
  if (a.classList.contains("lbl")) select(id);
  else if (a.classList.contains("remove")) remove(id);
});

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById("app")!);
