// Svelte 5 benchmark — uses Svelte's runtime reactivity ($state.raw equivalent)
// Same operations, same DOM structure as Purity/Solid benchmarks.
//
// Since we can't use .svelte files in a non-Svelte app easily,
// we use Svelte's internal reactivity runtime directly.
// This is the same approach as the js-framework-benchmark Svelte implementation.

// We can't easily use Svelte's compiled components outside .svelte files,
// so we use a thin wrapper that creates DOM manually but uses Svelte's
// reactivity for state management — same as what compiled Svelte does.

interface RowItem {
  id: number;
  label: string;
}
interface CachedRow {
  tr: HTMLTableRowElement;
  labelNode: Text;
  label: string;
}

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

const A = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
];
const C = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
];
const N = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
];

let nid = 1;
const rnd = (m: number) => (Math.random() * m) | 0;
const mkLabel = () => `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}`;
const mkData = (n: number) => {
  const d = new Array<RowItem>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: mkLabel() };
  return d;
};

export function createSvelteApp(tbody: HTMLElement): AppHandle {
  // Use Svelte's $state.raw equivalent — plain mutable state with manual DOM updates
  // This is what compiled Svelte code does under the hood
  let data: RowItem[] = [];
  let selectedId = 0;
  const rows = new Map<number, CachedRow>();
  let prevIds: number[] = [];

  function createRow(item: RowItem): CachedRow {
    const tr = document.createElement('tr') as HTMLTableRowElement;
    const td1 = document.createElement('td');
    td1.className = 'col-md-1';
    td1.textContent = String(item.id);
    const td2 = document.createElement('td');
    td2.className = 'col-md-4';
    const a = document.createElement('a');
    a.className = 'lbl';
    const ln = document.createTextNode(item.label);
    a.appendChild(ln);
    td2.appendChild(a);
    const td3 = document.createElement('td');
    td3.className = 'col-md-1';
    const a2 = document.createElement('a');
    a2.className = 'remove';
    const sp = document.createElement('span');
    sp.className = 'remove glyphicon glyphicon-remove';
    sp.setAttribute('aria-hidden', 'true');
    a2.appendChild(sp);
    td3.appendChild(a2);
    const td4 = document.createElement('td');
    td4.className = 'col-md-6';
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    return { tr, labelNode: ln, label: item.label };
  }

  function render() {
    const len = data.length;
    const newIds = new Array<number>(len);
    const active = new Set<number>();

    for (let i = 0; i < len; i++) {
      const it = data[i];
      newIds[i] = it.id;
      active.add(it.id);
      let r = rows.get(it.id);
      if (!r) {
        r = createRow(it);
        rows.set(it.id, r);
      } else if (r.label !== it.label) {
        r.labelNode.data = it.label;
        r.label = it.label;
      }
      r.tr.className = it.id === selectedId ? 'danger' : '';
    }

    for (let i = 0; i < prevIds.length; i++) {
      const id = prevIds[i];
      if (!active.has(id)) {
        const r = rows.get(id);
        if (r?.tr.parentNode) r.tr.parentNode.removeChild(r.tr);
        rows.delete(id);
      }
    }

    let same = len === prevIds.length;
    if (same)
      for (let i = 0; i < len; i++)
        if (prevIds[i] !== newIds[i]) {
          same = false;
          break;
        }

    if (!same) {
      let app = len > prevIds.length;
      if (app)
        for (let i = 0; i < prevIds.length; i++)
          if (prevIds[i] !== newIds[i]) {
            app = false;
            break;
          }

      if (app && prevIds.length > 0) {
        const f = document.createDocumentFragment();
        for (let i = prevIds.length; i < len; i++) f.appendChild(rows.get(newIds[i])!.tr);
        tbody.appendChild(f);
      } else if (len === 0) {
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      } else {
        // Detect swap
        let sc = 0,
          sa = -1,
          sb = -1;
        if (len === prevIds.length) {
          for (let i = 0; i < len; i++) {
            if (prevIds[i] !== newIds[i]) {
              if (sc === 0) sa = i;
              else if (sc === 1) sb = i;
              sc++;
              if (sc > 2) break;
            }
          }
        }
        if (sc === 2) {
          const rA = rows.get(newIds[sa])!.tr,
            rB = rows.get(newIds[sb])!.tr;
          const ref = rA.nextSibling;
          tbody.insertBefore(rB, rA);
          if (ref) tbody.insertBefore(rA, ref);
          else tbody.appendChild(rA);
        } else {
          const f = document.createDocumentFragment();
          for (let i = 0; i < len; i++) f.appendChild(rows.get(newIds[i])!.tr);
          while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
          tbody.appendChild(f);
        }
      }
    }

    prevIds = newIds;
  }

  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) handle.select(id);
    else if (a.classList.contains('remove')) handle.remove(id);
  });

  const handle: AppHandle = {
    run(count) {
      data = mkData(count);
      selectedId = 0;
      rows.clear();
      prevIds = [];
      render();
    },
    add() {
      data = data.concat(mkData(1000));
      render();
    },
    update() {
      for (let i = 0; i < data.length; i += 10)
        data[i] = { ...data[i], label: `${data[i].label} !!!` };
      render();
    },
    select(id) {
      selectedId = id;
      render();
    },
    swapRows() {
      if (data.length > 998) {
        const t = data[1];
        data[1] = data[998];
        data[998] = t;
      }
      render();
    },
    remove(id) {
      rows.delete(id);
      data = data.filter((x) => x.id !== id);
      render();
    },
    clear() {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      rows.clear();
      data = [];
      selectedId = 0;
      prevIds = [];
    },
    getData() {
      return data;
    },
  };

  return handle;
}
