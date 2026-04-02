import { each, html, state, when } from '@purity/core';

interface Item { id: number; label: string; }

let nextId = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Item ${nextId - 1}` };
  return d;
}

export function createConditionalApp(container: HTMLElement) {
  const data = state<Item[]>([]);
  const visible = state(true);

  const fragment = when(
    () => visible() && data().length > 0,
    () => {
      const table = html`<table class="table table-hover table-striped test-data"><tbody></tbody></table>` as unknown as HTMLTableElement;
      const tbody = table.querySelector('tbody')!;
      const rows = each(
        () => data(),
        (item: Item) => html`
          <tr>
            <td class="col-md-1">${String(item.id)}</td>
            <td class="col-md-4">${item.label}</td>
          </tr>
        ` as unknown as HTMLTableRowElement,
        (item: Item) => item.id,
      );
      tbody.appendChild(rows);
      return table;
    },
  );
  container.appendChild(fragment);

  document.getElementById('populate')!.addEventListener('click', () => {
    data(buildData(1000));
    visible(true);
  });

  document.getElementById('toggle')!.addEventListener('click', () => {
    visible(!visible());
  });

  document.getElementById('toggle-10x')!.addEventListener('click', () => {
    for (let i = 0; i < 10; i++) visible(!visible());
  });
}
