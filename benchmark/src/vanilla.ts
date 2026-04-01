// Vanilla JS baseline — same operations, zero framework overhead.
// Used to measure the exact cost Purity adds over raw DOM.

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

const adjectives = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const colours = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const nouns = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

let nextId = 1;
const random = (max: number) => (Math.random() * max) | 0;
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): RowItem[] {
  const d = new Array<RowItem>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

export function createVanillaApp(tbody: HTMLElement): AppHandle {
  let data: RowItem[] = [];
  let selectedId = 0;
  const rows = new Map<number, CachedRow>();

  function createRow(item: RowItem): CachedRow {
    const tr = document.createElement('tr') as HTMLTableRowElement;
    const td1 = document.createElement('td'); td1.className = 'col-md-1'; td1.textContent = String(item.id);
    const td2 = document.createElement('td'); td2.className = 'col-md-4';
    const a = document.createElement('a'); a.className = 'lbl';
    const labelNode = document.createTextNode(item.label); a.appendChild(labelNode); td2.appendChild(a);
    const td3 = document.createElement('td'); td3.className = 'col-md-1';
    const a2 = document.createElement('a'); a2.className = 'remove';
    const span = document.createElement('span'); span.className = 'remove glyphicon glyphicon-remove';
    span.setAttribute('aria-hidden', 'true'); a2.appendChild(span); td3.appendChild(a2);
    const td4 = document.createElement('td'); td4.className = 'col-md-6';
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    const row: CachedRow = { tr, labelNode, label: item.label };
    rows.set(item.id, row);
    return row;
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
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      rows.clear();
      data = buildData(count);
      selectedId = 0;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < data.length; i++) frag.appendChild(createRow(data[i]).tr);
      tbody.appendChild(frag);
    },
    add() {
      const newData = buildData(1000);
      data = data.concat(newData);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < newData.length; i++) frag.appendChild(createRow(newData[i]).tr);
      tbody.appendChild(frag);
    },
    update() {
      for (let i = 0; i < data.length; i += 10) {
        data[i].label += ' !!!';
        const row = rows.get(data[i].id);
        if (row) { row.labelNode.data = data[i].label; row.label = data[i].label; }
      }
    },
    select(id) {
      if (selectedId) { const r = rows.get(selectedId); if (r) r.tr.className = ''; }
      selectedId = id;
      const r = rows.get(id); if (r) r.tr.className = 'danger';
    },
    swapRows() {
      if (data.length > 998) {
        const tmp = data[1]; data[1] = data[998]; data[998] = tmp;
        const tr1 = rows.get(data[1].id)!.tr;
        const tr998 = rows.get(data[998].id)!.tr;
        const ref = tr1.nextSibling;
        tbody.insertBefore(tr998, tr1);
        if (ref) tbody.insertBefore(tr1, ref); else tbody.appendChild(tr1);
      }
    },
    remove(id) {
      const row = rows.get(id);
      if (row?.tr.parentNode) row.tr.parentNode.removeChild(row.tr);
      rows.delete(id);
      data = data.filter(item => item.id !== id);
    },
    clear() {
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      rows.clear();
      data = [];
      selectedId = 0;
    },
    getData() { return data; },
  };

  return handle;
}
