import { each, html, mount, state } from '@purityjs/core';

type Scenario = 'keyed' | 'virtual';

interface Row {
  id: number;
  label: string;
}

interface MemoryProbe {
  runBatch(scenario: Scenario, cycles: number, retain?: boolean): Promise<void>;
  retained(): { hosts: number; rows: number; states: number };
  reset(): void;
}

declare global {
  interface Window {
    __purityMemoryProbe: MemoryProbe;
  }
}

const hostRefs: WeakRef<Element>[] = [];
const rowRefs: WeakRef<Element>[] = [];
const stateRefs: WeakRef<Function>[] = [];
const positiveControl: { host: Element; row: Element; items: Function }[] = [];

function buildRows(count: number): Row[] {
  const rows = new Array<Row>(count);
  for (let i = 0; i < count; i++) rows[i] = { id: i, label: `Row ${i}` };
  return rows;
}

async function runCycle(scenario: Scenario, retain: boolean): Promise<void> {
  const host = document.createElement('div');
  host.style.cssText = 'height:240px;overflow-y:auto';
  document.body.appendChild(host);

  const items = state(buildRows(scenario === 'virtual' ? 1000 : 100));
  const mounted = mount(() => {
    const fragment = each(
      () => items(),
      (item) => html`<div class="row">${() => item().label}</div>`,
      (item) => item.id,
      { virtual: scenario === 'virtual' },
    );
    if (!(fragment instanceof DocumentFragment)) throw new Error('Expected a browser list');
    return fragment;
  }, host);
  await Promise.resolve();

  if (scenario === 'virtual') {
    host.scrollTop = host.scrollHeight;
    host.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  } else {
    items([...items()].reverse());
    await Promise.resolve();
  }

  const firstRow = host.querySelector('.row');
  if (!firstRow) throw new Error(`${scenario} did not render a row`);
  hostRefs.push(new WeakRef(host));
  rowRefs.push(new WeakRef(firstRow));
  stateRefs.push(new WeakRef(items));
  mounted.unmount();
  host.remove();
  if (retain) positiveControl.push({ host, row: firstRow, items });
}

window.__purityMemoryProbe = {
  async runBatch(scenario, cycles, retain = false) {
    for (let i = 0; i < cycles; i++) await runCycle(scenario, retain);
  },
  retained() {
    let hosts = 0;
    let rows = 0;
    let states = 0;
    for (let i = 0; i < hostRefs.length; i++) if (hostRefs[i].deref()) hosts++;
    for (let i = 0; i < rowRefs.length; i++) if (rowRefs[i].deref()) rows++;
    for (let i = 0; i < stateRefs.length; i++) if (stateRefs[i].deref()) states++;
    return { hosts, rows, states };
  },
  reset() {
    hostRefs.length = 0;
    rowRefs.length = 0;
    stateRefs.length = 0;
    positiveControl.length = 0;
  },
};
