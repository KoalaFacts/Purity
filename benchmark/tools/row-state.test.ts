import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

type Row = { id: number; label: string | (() => string) };
const probe = vi.hoisted(() => ({ rows: undefined as undefined | (() => Row[]) }));
vi.mock('@purityjs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@purityjs/core')>();
  return {
    ...actual,
    each: (...args: Parameters<typeof actual.each>) => {
      probe.rows = args[0] as () => Row[];
      return actual.each(...args);
    },
  };
});

const labelOf = (row: Row) => (typeof row.label === 'function' ? row.label() : row.label);
async function click(selector: string) {
  document.querySelector<HTMLElement>(selector)!.click();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test('label updates retain list and row identity while structural actions publish arrays', async () => {
  document.documentElement.innerHTML = readFileSync('apps/purity/index.html', 'utf8');
  await import('../apps/purity/app.ts');
  await click('#run-100');
  const rows = probe.rows!();
  const identities = [...rows];
  const accessors = rows.map((row) => row.label);
  const labels = rows.map(labelOf);
  const nodes = Array.from(document.querySelectorAll('tbody tr'));
  await click('tbody tr:first-child .lbl');
  for (let count = 1; count <= 2; count++) {
    await click('#update');
    expect(probe.rows!()).toBe(rows);
    rows.forEach((row, index) => {
      expect(row).toBe(identities[index]);
      expect(row.label).toBe(accessors[index]);
      expect(typeof row.label).toBe('function');
      expect(labelOf(row)).toBe(labels[index] + (index % 10 === 0 ? ' !!!'.repeat(count) : ''));
      expect(document.querySelectorAll('tbody tr')[index]).toBe(nodes[index]);
      expect(nodes[index].querySelector('.lbl')!.textContent).toBe(labelOf(row));
    });
    expect(nodes[0].classList.contains('danger')).toBe(true);
  }
  await click('#add');
  const appended = probe.rows!();
  expect(appended).not.toBe(rows);
  expect(appended).toHaveLength(1100);
  identities.forEach((row, index) => expect(appended[index]).toBe(row));
  await click('#swaprows');
  const swapped = probe.rows!();
  expect(swapped).not.toBe(appended);
  expect(swapped[1]).toBe(appended[998]);
  expect(swapped[998]).toBe(appended[1]);
  await click('tbody tr:first-child .remove');
  expect(probe.rows!()).not.toBe(swapped);
  expect(probe.rows!()).toHaveLength(1099);
  expect(probe.rows!().some((row) => row === identities[0])).toBe(false);
  await click('#clear');
  expect(probe.rows!()).toEqual([]);
  expect(document.querySelectorAll('tbody tr')).toHaveLength(0);
});
