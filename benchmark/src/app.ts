// Shared benchmark app using Purity public APIs: state, watch, each.

import { each, state, watch } from '../../packages/core/src/index.ts';

const adjectives = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const colours = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const nouns = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

interface RowItem { id: number; label: string }
interface CachedRow { tr: HTMLTableRowElement; labelNode: Text; label: string }

export interface AppHandle {
  run(count: number): void;
  add(): void;
  update(): void;
  select(id: number): void;
  swapRows(): void;
  remove(id: number): void;
  clear(): void;
  getData(): RowItem[];
}

let nextId = 1;
const random = (max: number) => (Math.random() * max) | 0;
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): RowItem[] {
  const d = new Array<RowItem>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

export function createApp(tbody: HTMLElement): AppHandle {
  const data = state<RowItem[]>([]);
  const selectedId = state(0);
  const rows = new Map<number, CachedRow>();

  // Render via each() — Purity's keyed list with LIS reconciliation
  const fragment = each(
    () => data(),
    (item: RowItem) => {
      const tr = document.createElement('tr');

      const td1 = document.createElement('td');
      td1.className = 'col-md-1';
      td1.textContent = String(item.id);

      const td2 = document.createElement('td');
      td2.className = 'col-md-4';
      const a = document.createElement('a');
      a.className = 'lbl';
      const labelNode = document.createTextNode(item.label);
      a.appendChild(labelNode);
      td2.appendChild(a);

      const td3 = document.createElement('td');
      td3.className = 'col-md-1';
      const a2 = document.createElement('a');
      a2.className = 'remove';
      const span = document.createElement('span');
      span.className = 'remove glyphicon glyphicon-remove';
      span.setAttribute('aria-hidden', 'true');
      a2.appendChild(span);
      td3.appendChild(a2);

      const td4 = document.createElement('td');
      td4.className = 'col-md-6';

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);

      rows.set(item.id, { tr, labelNode, label: item.label });
      return tr;
    },
    (item: RowItem) => item.id,
  );
  tbody.appendChild(fragment);

  // In-place label updates
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
    if (oldId) { const r = rows.get(oldId); if (r) r.tr.className = ''; }
    if (id) { const r = rows.get(id); if (r) r.tr.className = 'danger'; }
  });

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) handle.select(id);
    else if (a.classList.contains('remove')) handle.remove(id);
  });

  const handle: AppHandle = {
    run(count) { data(buildData(count)); selectedId(0); },
    add() { data(d => d.concat(buildData(1000))); },
    update() {
      data(d => {
        const c = d.slice();
        for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
        return c;
      });
    },
    select(id) { selectedId(id); },
    swapRows() {
      data(d => {
        if (d.length > 998) {
          const c = d.slice();
          const tmp = c[1]; c[1] = c[998]; c[998] = tmp;
          return c;
        }
        return d;
      });
    },
    remove(id) { rows.delete(id); data(d => d.filter(item => item.id !== id)); },
    clear() { rows.clear(); data([]); selectedId(0); },
    getData() { return data(); },
  };

  return handle;
}
