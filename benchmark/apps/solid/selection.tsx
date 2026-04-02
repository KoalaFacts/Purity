import { For, createEffect, createMemo, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

interface SelectItem { id: number; label: string; selected: boolean; }

export function createSelectionApp(
  container: HTMLElement,
  countEl: HTMLElement,
  totalEl: HTMLElement,
  allSelectedEl: HTMLElement,
  populateBtn: HTMLElement,
  selectAllBtn: HTMLElement,
  deselectAllBtn: HTMLElement,
  toggleAllBtn: HTMLElement,
  toggleEvenBtn: HTMLElement,
) {
  const [items, setItems] = createSignal<SelectItem[]>([]);

  const selectedCount = createMemo(() => items().filter(i => i.selected).length);
  const allSelected = createMemo(() => items().length > 0 && items().every(i => i.selected));

  createEffect(() => { countEl.textContent = String(selectedCount()); });
  createEffect(() => { totalEl.textContent = String(items().length); });
  createEffect(() => { allSelectedEl.textContent = allSelected() ? 'Yes' : 'No'; });

  function buildItems(): SelectItem[] {
    const arr: SelectItem[] = [];
    for (let i = 0; i < 1000; i++) {
      arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
    }
    return arr;
  }

  populateBtn.addEventListener('click', () => { setItems(buildItems()); });

  selectAllBtn.addEventListener('click', () => {
    setItems(items().map(i => ({ ...i, selected: true })));
  });

  deselectAllBtn.addEventListener('click', () => {
    setItems(items().map(i => ({ ...i, selected: false })));
  });

  toggleAllBtn.addEventListener('click', () => {
    setItems(items().map(i => ({ ...i, selected: !i.selected })));
  });

  toggleEvenBtn.addEventListener('click', () => {
    setItems(items().map(i => i.id % 2 === 0 ? { ...i, selected: !i.selected } : i));
  });

  render(() => (
    <For each={items()}>
      {(item: SelectItem) => (
        <div>
          <input type="checkbox" checked={item.selected} />
          {item.label}
        </div>
      )}
    </For>
  ), container);
}
