import { describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { html } from '../src/compiler/compile.ts';
import { swapSlot } from '../src/runtime/csr-runtime.ts';
import { tick } from './_helpers.ts';

// CQ-04: a text slot that receives a primitive keeps its Text node, maps
// undefined/false/null to empty content, and writes nothing when the text is
// unchanged. MutationObserver records are the observable cost.
function slotHost(initial = 'x'): { parent: HTMLElement; text: Text } {
  const parent = document.createElement('div');
  const text = document.createTextNode(initial);
  parent.appendChild(text);
  return { parent, text };
}

function mutations(target: Node, run: () => void): Promise<MutationRecord[]> {
  return new Promise((resolve) => {
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(target, { characterData: true, childList: true, subtree: true });
    run();
    queueMicrotask(() => {
      records.push(...observer.takeRecords());
      observer.disconnect();
      resolve(records);
    });
  });
}

describe('swapSlot text fast path (CQ-04)', () => {
  const cases: Array<[unknown, string]> = [
    [undefined, ''],
    [false, ''],
    [null, ''],
    [0, '0'],
    ['', ''],
    [true, 'true'],
    [12.5, '12.5'],
    ['hello', 'hello'],
  ];

  for (const [value, expected] of cases) {
    it(`renders ${String(value) || "''"} as ${JSON.stringify(expected)} in the same Text node`, () => {
      const { parent, text } = slotHost();
      const result = swapSlot(text, value);
      expect(result).toBe(text);
      expect(parent.childNodes.length).toBe(1);
      expect(parent.textContent).toBe(expected);
    });
  }

  it('writes nothing when the text is unchanged', async () => {
    const { parent, text } = slotHost('same');
    const records = await mutations(parent, () => {
      swapSlot(text, 'same');
      swapSlot(text, 'same');
    });
    expect(records).toEqual([]);
  });

  it('writes nothing when an empty-mapped value repeats', async () => {
    const { parent, text } = slotHost('');
    const records = await mutations(parent, () => {
      swapSlot(text, undefined);
      swapSlot(text, false);
      swapSlot(text, null);
      swapSlot(text, '');
    });
    expect(records).toEqual([]);
  });

  it('records exactly one characterData mutation for a changed value', async () => {
    const { parent, text } = slotHost('a');
    const records = await mutations(parent, () => {
      swapSlot(text, 'b');
    });
    expect(records.map((r) => r.type)).toEqual(['characterData']);
    expect(text.data).toBe('b');
  });

  it('still replaces a Text node when a node value arrives, and back again', () => {
    const { parent, text } = slotHost('a');
    const span = document.createElement('span');
    const afterNode = swapSlot(text, span);
    expect(afterNode).toBe(span);
    expect(parent.firstChild).toBe(span);
    const afterText = swapSlot(afterNode, 'back');
    expect((afterText as Text).nodeType).toBe(3);
    expect(parent.textContent).toBe('back');
  });

  it('keeps an array of strings as one Text node and skips equal writes', async () => {
    const { parent, text } = slotHost('ab');
    const records = await mutations(parent, () => {
      expect(swapSlot(text, ['a', 'b'])).toBe(text);
    });
    expect(records).toEqual([]);
  });

  it('a reactive text binding re-run with an equal value causes no DOM mutation', async () => {
    const label = state('one');
    const other = state(0);
    const host = document.createElement('div');
    // Both bindings share one grouped watcher; changing `other` re-runs the label binding.
    host.appendChild(html`<p><b>${() => label()}</b><i>${() => other()}</i></p>`);
    const b = host.querySelector('b')!;
    const records = await mutations(b, () => other(1));
    await tick();
    expect(host.querySelector('i')!.textContent).toBe('1');
    expect(records).toEqual([]);
    expect(b.textContent).toBe('one');
  });
});
