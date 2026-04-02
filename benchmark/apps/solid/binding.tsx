import { type Accessor, createSignal, For, type Setter } from 'solid-js';
import { render } from 'solid-js/web';

interface Field {
  id: number;
  value: Accessor<string>;
  setValue: Setter<string>;
}

export function createBindingApp(
  container: HTMLElement,
  result: HTMLElement,
  create100Btn: HTMLElement,
  create1000Btn: HTMLElement,
  updateAllBtn: HTMLElement,
  clearAllBtn: HTMLElement,
  readAllBtn: HTMLElement,
) {
  const [fields, setFields] = createSignal<Field[]>([]);

  function createFields(count: number) {
    const arr: Field[] = [];
    for (let i = 0; i < count; i++) {
      const [value, setValue] = createSignal('');
      arr.push({ id: i + 1, value, setValue });
    }
    setFields(arr);
    result.textContent = `Created ${count} fields`;
  }

  create100Btn.addEventListener('click', () => createFields(100));
  create1000Btn.addEventListener('click', () => createFields(1000));

  updateAllBtn.addEventListener('click', () => {
    const current = fields();
    for (let i = 0; i < current.length; i++) {
      current[i].setValue(`updated-${current[i].id}`);
    }
    result.textContent = `Updated ${current.length} fields`;
  });

  clearAllBtn.addEventListener('click', () => {
    const current = fields();
    for (let i = 0; i < current.length; i++) {
      current[i].setValue('');
    }
    result.textContent = `Cleared ${current.length} fields`;
  });

  readAllBtn.addEventListener('click', () => {
    const current = fields();
    let count = 0;
    for (let i = 0; i < current.length; i++) {
      current[i].value();
      count++;
    }
    result.textContent = `Read ${count} fields`;
  });

  render(
    () => (
      <For each={fields()}>
        {(field: Field) => (
          <div>
            <label>Field {field.id}:</label>
            <input value={field.value()} onInput={(e) => field.setValue(e.currentTarget.value)} />
          </div>
        )}
      </For>
    ),
    container,
  );
}
