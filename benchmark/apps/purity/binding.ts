import { each, html, state } from '@purity/core';

type StateAccessor<T> = ReturnType<typeof state<T>>;

interface FieldEntry { id: number; signal: StateAccessor<string>; }

export function createBindingApp(
  container: HTMLElement,
  result: HTMLElement,
  create100Btn: HTMLElement,
  create1000Btn: HTMLElement,
  updateAllBtn: HTMLElement,
  clearAllBtn: HTMLElement,
  readAllBtn: HTMLElement,
) {
  const fields = state<FieldEntry[]>([]);

  const fragment = each(
    () => fields(),
    (field: FieldEntry) => {
      const el = html`
        <div>
          <label>Field ${String(field.id)}:</label>
          <input ::value=${field.signal} />
        </div>
      ` as unknown as HTMLElement;
      return el;
    },
    (field: FieldEntry) => field.id,
  );
  container.appendChild(fragment);

  function createFields(count: number) {
    const arr: FieldEntry[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({ id: i + 1, signal: state('') });
    }
    fields(arr);
    result.textContent = `Created ${count} fields`;
  }

  create100Btn.addEventListener('click', () => createFields(100));
  create1000Btn.addEventListener('click', () => createFields(1000));

  updateAllBtn.addEventListener('click', () => {
    const current = fields();
    for (let i = 0; i < current.length; i++) {
      current[i].signal(`updated-${current[i].id}`);
    }
    result.textContent = `Updated ${current.length} fields`;
  });

  clearAllBtn.addEventListener('click', () => {
    const current = fields();
    for (let i = 0; i < current.length; i++) {
      current[i].signal('');
    }
    result.textContent = `Cleared ${current.length} fields`;
  });

  readAllBtn.addEventListener('click', () => {
    const current = fields();
    let count = 0;
    for (let i = 0; i < current.length; i++) {
      current[i].signal();
      count++;
    }
    result.textContent = `Read ${count} fields`;
  });
}
