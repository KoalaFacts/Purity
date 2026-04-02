// Solid benchmark — uses <For>, createSignal, JSX templates.
// Per-row signals for labels (idiomatic Solid pattern for keyed lists).

import { type Accessor, For, type Setter, batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

const A = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const C = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const N = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;

interface Row {
  id: number;
  label: Accessor<string>;
  setLabel: Setter<string>;
}

function mkData(n: number): Row[] {
  const d = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const [label, setLabel] = createSignal(mkLabel());
    d[i] = { id: nid++, label, setLabel };
  }
  return d;
}

export interface AppHandle {
  run(count: number): void;
  add(): void;
  update(): void;
  select(id: number): void;
  swapRows(): void;
  remove(id: number): void;
  clear(): void;
  getData(): { id: number; label: string }[];
}

export function createSolidApp(tbody: HTMLElement): AppHandle {
  const [data, setData] = createSignal<Row[]>([]);
  const [selectedId, setSelectedId] = createSignal(0);

  const handle: AppHandle = {
    run(count) {
      batch(() => { setData(mkData(count)); setSelectedId(0); });
    },
    add() {
      setData(d => d.concat(mkData(1000)));
    },
    update() {
      const d = data();
      for (let i = 0; i < d.length; i += 10) {
        d[i].setLabel(l => `${l} !!!`);
      }
    },
    select(id) { setSelectedId(id); },
    swapRows() {
      setData(d => {
        if (d.length > 998) {
          const c = d.slice();
          const t = c[1]; c[1] = c[998]; c[998] = t;
          return c;
        }
        return d;
      });
    },
    remove(id) { setData(d => d.filter(r => r.id !== id)); },
    clear() {
      batch(() => { setData([]); setSelectedId(0); });
    },
    getData() {
      return data().map(r => ({ id: r.id, label: r.label() }));
    },
  };

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) handle.select(id);
    else if (a.classList.contains('remove')) handle.remove(id);
  });

  render(() => (
    <For each={data()}>
      {(row: Row) => (
        <tr class={row.id === selectedId() ? 'danger' : ''}>
          <td class="col-md-1">{row.id}</td>
          <td class="col-md-4"><a class="lbl">{row.label()}</a></td>
          <td class="col-md-1"><a class="remove"><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      )}
    </For>
  ), tbody);

  return handle;
}
