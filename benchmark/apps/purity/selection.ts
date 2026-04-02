import { compute, each, html, state, watch } from '@purity/core';

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
  const items = state<SelectItem[]>([]);

  const selectedCount = compute(() => items().filter(i => i.selected).length);
  const allSelected = compute(() => items().length > 0 && items().every(i => i.selected));

  watch(() => { countEl.textContent = String(selectedCount()); });
  watch(() => { totalEl.textContent = String(items().length); });
  watch(() => { allSelectedEl.textContent = allSelected() ? 'Yes' : 'No'; });

  const fragment = each(
    () => items(),
    (item: SelectItem) => {
      const el = html`
        <div>
          <input type="checkbox" ${item.selected ? 'checked' : ''} />
          ${item.label}
        </div>
      ` as unknown as HTMLElement;
      return el;
    },
    (item: SelectItem) => item.id,
  );
  container.appendChild(fragment);

  function buildItems(): SelectItem[] {
    const arr: SelectItem[] = [];
    for (let i = 0; i < 1000; i++) {
      arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
    }
    return arr;
  }

  populateBtn.addEventListener('click', () => { items(buildItems()); });

  selectAllBtn.addEventListener('click', () => {
    items(items().map(i => ({ ...i, selected: true })));
  });

  deselectAllBtn.addEventListener('click', () => {
    items(items().map(i => ({ ...i, selected: false })));
  });

  toggleAllBtn.addEventListener('click', () => {
    items(items().map(i => ({ ...i, selected: !i.selected })));
  });

  toggleEvenBtn.addEventListener('click', () => {
    items(items().map(i => i.id % 2 === 0 ? { ...i, selected: !i.selected } : i));
  });
}
