// SolidJS benchmark — uses createSignal, createEffect, batch
// Same operations, same DOM structure as Purity benchmark.

import { createSignal, createEffect, batch } from 'solid-js';

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

const A = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const C = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const N = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;
const mkData = (n: number) => {
  const d = new Array<RowItem>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: mkLabel() };
  return d;
};

export function createSolidApp(tbody: HTMLElement): AppHandle {
  const [data, setData] = createSignal<RowItem[]>([]);
  const [selectedId, setSelectedId] = createSignal(0);
  const rows = new Map<number, CachedRow>();

  function createRow(item: RowItem): CachedRow {
    const tr = document.createElement('tr') as HTMLTableRowElement;
    const td1 = document.createElement('td'); td1.className = 'col-md-1'; td1.textContent = String(item.id);
    const td2 = document.createElement('td'); td2.className = 'col-md-4';
    const a = document.createElement('a'); a.className = 'lbl';
    const ln = document.createTextNode(item.label); a.appendChild(ln); td2.appendChild(a);
    const td3 = document.createElement('td'); td3.className = 'col-md-1';
    const a2 = document.createElement('a'); a2.className = 'remove';
    const sp = document.createElement('span'); sp.className = 'remove glyphicon glyphicon-remove';
    sp.setAttribute('aria-hidden', 'true'); a2.appendChild(sp); td3.appendChild(a2);
    const td4 = document.createElement('td'); td4.className = 'col-md-6';
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    const row: CachedRow = { tr, labelNode: ln, label: item.label };
    rows.set(item.id, row);
    return row;
  }

  // Keyed reconciliation via createEffect
  let prevIds: number[] = [];

  createEffect(() => {
    const list = data();
    const sel = selectedId();
    const len = list.length;
    const newIds = new Array<number>(len);
    const active = new Set<number>();

    for (let i = 0; i < len; i++) {
      const it = list[i]; newIds[i] = it.id; active.add(it.id);
      let r = rows.get(it.id);
      if (!r) { r = createRow(it); }
      else if (r.label !== it.label) { r.labelNode.data = it.label; r.label = it.label; }
      r.tr.className = it.id === sel ? 'danger' : '';
    }

    for (let i = 0; i < prevIds.length; i++) {
      const id = prevIds[i];
      if (!active.has(id)) { const r = rows.get(id); if (r?.tr.parentNode) r.tr.parentNode.removeChild(r.tr); rows.delete(id); }
    }

    let same = len === prevIds.length;
    if (same) for (let i = 0; i < len; i++) if (prevIds[i] !== newIds[i]) { same = false; break; }

    if (!same) {
      let app = len > prevIds.length;
      if (app) for (let i = 0; i < prevIds.length; i++) if (prevIds[i] !== newIds[i]) { app = false; break; }

      if (app && prevIds.length > 0) {
        const f = document.createDocumentFragment();
        for (let i = prevIds.length; i < len; i++) f.appendChild(rows.get(newIds[i])!.tr);
        tbody.appendChild(f);
      } else {
        const f = document.createDocumentFragment();
        for (let i = 0; i < len; i++) f.appendChild(rows.get(newIds[i])!.tr);
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        tbody.appendChild(f);
      }
    }

    prevIds = newIds;
  });

  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a'); if (!a) return; e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) handle.select(id);
    else if (a.classList.contains('remove')) handle.remove(id);
  });

  const handle: AppHandle = {
    run(count) { batch(() => { setData(mkData(count)); setSelectedId(0); }); },
    add() { setData(d => d.concat(mkData(1000))); },
    update() { setData(d => { const c = d.slice(); for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` }; return c; }); },
    select(id) { setSelectedId(id); },
    swapRows() { setData(d => { if (d.length > 998) { const c = d.slice(); const t = c[1]; c[1] = c[998]; c[998] = t; return c; } return d; }); },
    remove(id) { rows.delete(id); setData(d => d.filter(x => x.id !== id)); },
    clear() { rows.clear(); batch(() => { setData([]); setSelectedId(0); }); },
    getData() { return data(); },
  };

  return handle;
}
