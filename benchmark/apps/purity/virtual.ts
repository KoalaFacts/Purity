import { each, html, state } from '@purityjs/core';

interface Row {
  id: number;
  label: string;
}

function buildRows(): Row[] {
  const rows = new Array<Row>(10_000);
  for (let i = 0; i < rows.length; i++) rows[i] = { id: i, label: `Row ${i}` };
  return rows;
}

const fullRows = state<Row[]>([]);
const virtualRows = state<Row[]>([]);
const shadowRows = state<Row[]>([]);
const fullViewport = document.getElementById('full-viewport')!;
const virtualViewport = document.getElementById('virtual-viewport')!;
const shadowViewport = document.getElementById('shadow-viewport')!;
const shadowHost = document.createElement('div');
const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
const shadowStyle = document.createElement('style');
shadowStyle.textContent =
  '.row{box-sizing:border-box;border-bottom:1px solid #ddd;height:32px;line-height:31px;padding:0 8px}';
shadowRoot.appendChild(shadowStyle);
shadowViewport.appendChild(shadowHost);
const mountedCount = document.getElementById('mounted-count')!;

function updateMountedCount(viewport: HTMLElement): void {
  queueMicrotask(() => {
    mountedCount.textContent = `${viewport.querySelectorAll('.row').length} mounted rows`;
  });
}

function renderRow(row: () => Row) {
  return html`<div class="row">${() => row().label}</div>`;
}

fullViewport.appendChild(
  each(
    () => fullRows(),
    renderRow,
    (row) => row.id,
  ),
);
virtualViewport.appendChild(
  each(
    () => virtualRows(),
    renderRow,
    (row) => row.id,
    { virtual: true },
  ),
);
shadowRoot.appendChild(
  each(
    () => shadowRows(),
    renderRow,
    (row) => row.id,
    { virtual: true },
  ),
);

document.getElementById('create-full')!.addEventListener('click', () => {
  virtualRows([]);
  shadowRows([]);
  fullViewport.scrollTop = 0;
  virtualViewport.hidden = true;
  shadowViewport.hidden = true;
  fullViewport.hidden = false;
  fullRows(buildRows());
  updateMountedCount(fullViewport);
});

document.getElementById('create-virtual')!.addEventListener('click', () => {
  fullRows([]);
  shadowRows([]);
  virtualViewport.scrollTop = 0;
  fullViewport.hidden = true;
  shadowViewport.hidden = true;
  virtualViewport.hidden = false;
  virtualRows(buildRows());
  updateMountedCount(virtualViewport);
});

document.getElementById('create-shadow')!.addEventListener('click', () => {
  fullRows([]);
  virtualRows([]);
  shadowViewport.scrollTop = 0;
  fullViewport.hidden = true;
  virtualViewport.hidden = true;
  shadowViewport.hidden = false;
  shadowRows(buildRows());
  updateMountedCount(shadowViewport);
});

document.getElementById('clear')!.addEventListener('click', () => {
  fullRows([]);
  virtualRows([]);
  shadowRows([]);
  fullViewport.scrollTop = 0;
  virtualViewport.scrollTop = 0;
  shadowViewport.scrollTop = 0;
  fullViewport.hidden = true;
  virtualViewport.hidden = true;
  shadowViewport.hidden = true;
  mountedCount.textContent = '0 mounted rows';
});
