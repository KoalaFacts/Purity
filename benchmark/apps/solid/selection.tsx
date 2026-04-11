// Selection benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createMemo, createSignal, For } from "solid-js";
import { render } from "solid-js/web";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectItem {
  id: number;
  label: string;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Module-level signals
// ---------------------------------------------------------------------------

const [items, setItems] = createSignal<SelectItem[]>([]);

const selectedCount = createMemo(() => items().filter((i) => i.selected).length);
const allSelected = createMemo(() => items().length > 0 && items().every((i) => i.selected));

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

function HBtn(props: { id: string; onClick: () => void; children: any }) {
  return (
    <button type="button" id={props.id} style={{ display: "none" }} onClick={props.onClick}>
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
            <h1>Solid (Selection)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => setItems(buildItems(1000))}
                >
                  Populate 1k
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-all"
                  onClick={() => setItems(items().map((i) => ({ ...i, selected: true })))}
                >
                  Select All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="deselect-all"
                  onClick={() => setItems(items().map((i) => ({ ...i, selected: false })))}
                >
                  Deselect All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-all"
                  onClick={() => setItems(items().map((i) => ({ ...i, selected: !i.selected })))}
                >
                  Toggle All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-even"
                  onClick={() =>
                    setItems(
                      items().map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i)),
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
        Selected: <span id="count">{selectedCount()}</span> /{" "}
        <span id="total">{items().length}</span> | All:{" "}
        <span id="all-selected">{allSelected() ? "Yes" : "No"}</span>
      </div>
      <div id="container">
        <For each={items()}>
          {(item: SelectItem) => (
            <div>
              <input type="checkbox" checked={item.selected} />
              {item.label}
            </div>
          )}
        </For>
      </div>
    </>
  );
}

render(App, document.getElementById("app")!);
