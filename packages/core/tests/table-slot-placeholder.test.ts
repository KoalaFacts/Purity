import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { each, hydrate, mount, state } from '../src/index.ts';
import { html } from '../src/compiler/jit.ts';
import { tick } from './_helpers.ts';

// A lone `${...}` directly inside a table section must not compile to a text
// placeholder: the HTML parser foster-parents text out of <tbody>, so the
// compiled slot path would no longer point at the slot.
describe('each() rows directly inside table sections', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  const rowsOf = (table: Element | null, section: string) =>
    Array.from(table?.querySelector(section)?.querySelectorAll('tr') ?? []).map(
      (tr) => tr.textContent,
    );

  type Row = { id: number; name: string };
  const rowView = (row: () => Row) => html`<tr><td>${() => row().name}</td></tr>`;
  const key = (row: Row) => row.id;
  const views: Record<string, (rows: () => Row[]) => unknown> = {
    tbody: (rows) => html`<table><tbody>${each(rows, rowView, key)}</tbody></table>`,
    thead: (rows) => html`<table><thead>${each(rows, rowView, key)}</thead></table>`,
    tfoot: (rows) => html`<table><tfoot>${each(rows, rowView, key)}</tfoot></table>`,
  };

  for (const section of Object.keys(views)) {
    it(`renders and updates keyed rows inside <${section}> (JIT)`, async () => {
      const rows = state<Row[]>([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ]);
      const view = () => views[section](() => rows());
      mount(view, host);
      const table = host.querySelector('table');
      expect(host.firstElementChild).toBe(table);
      expect(table?.previousSibling).toBeNull();
      expect(rowsOf(table, section)).toEqual(['a', 'b']);

      rows([
        { id: 2, name: 'b2' },
        { id: 3, name: 'c' },
      ]);
      await tick();
      expect(rowsOf(table, section)).toEqual(['b2', 'c']);
      expect(table?.previousSibling).toBeNull();
    });
  }

  it('renders rows inside <tbody> preceded by a static <thead>', () => {
    const rows = state(['x', 'y']);
    mount(
      () =>
        html`<table><thead><tr><th>h</th></tr></thead><tbody>${each(
          () => rows(),
          (row) => html`<tr><td>${() => row()}</td></tr>`,
        )}</tbody></table>`,
      host,
    );
    const table = host.querySelector('table');
    expect(rowsOf(table, 'tbody')).toEqual(['x', 'y']);
    expect(rowsOf(table, 'thead')).toEqual(['h']);
  });

  it('hydrates SSR rows inside <tbody> in place and keeps them reactive', async () => {
    host.innerHTML =
      '<table><tbody><!--[--><!--e--><!--er:1--><tr><td><!--[-->a<!--]--></td></tr><!--/er-->' +
      '<!--er:2--><tr><td><!--[-->b<!--]--></td></tr><!--/er--><!--/e--><!--]--></tbody></table>';
    const ssrTable = host.querySelector('table');
    const ssrFirstRow = host.querySelector('tr');
    const rows = state([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ]);
    hydrate(
      host,
      () =>
        html`<table><tbody>${each(
          () => rows(),
          (row) => html`<tr><td>${() => row().name}</td></tr>`,
          (row) => row.id,
        )}</tbody></table>`,
    );
    expect(host.querySelector('table')).toBe(ssrTable);
    expect(host.querySelector('tr')).toBe(ssrFirstRow);
    rows([
      { id: 1, name: 'a2' },
      { id: 2, name: 'b' },
      { id: 3, name: 'c' },
    ]);
    await tick();
    expect(rowsOf(host.querySelector('table'), 'tbody')).toEqual(['a2', 'b', 'c']);
    expect(host.querySelector('tr')).toBe(ssrFirstRow);
  });
});
