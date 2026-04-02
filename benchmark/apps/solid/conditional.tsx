import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';

interface Item {
  id: number;
  label: string;
}

let nextId = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Item ${nextId - 1}` };
  return d;
}

export function createConditionalApp(container: HTMLElement) {
  const [data, setData] = createSignal<Item[]>([]);
  const [visible, setVisible] = createSignal(true);

  render(
    () => (
      <Show when={visible() && data().length > 0}>
        <table class="table table-hover table-striped test-data">
          <tbody>
            <For each={data()}>
              {(item: Item) => (
                <tr>
                  <td class="col-md-1">{item.id}</td>
                  <td class="col-md-4">{item.label}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    ),
    container,
  );

  document.getElementById('populate')!.addEventListener('click', () => {
    setData(buildData(1000));
    setVisible(true);
  });

  document.getElementById('toggle')!.addEventListener('click', () => {
    setVisible((v) => !v);
  });

  document.getElementById('toggle-10x')!.addEventListener('click', () => {
    for (let i = 0; i < 10; i++) setVisible((v) => !v);
  });
}
