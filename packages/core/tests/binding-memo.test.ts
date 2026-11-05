import { afterEach, describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { html } from '../src/compiler/compile.ts';
import { hydrate } from '../src/index.ts';
import { tick } from './_helpers.ts';

// CQ-03: all reactive bindings of a template share one watcher. Changing one
// binding must not re-apply its siblings: no attribute writes (style
// invalidation) and no `.value` writes (caret, selection and IME state).

function attributeMutations(target: Node): { records: MutationRecord[]; stop: () => void } {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(target, { attributes: true, subtree: true });
  return {
    records,
    stop: () => {
      records.push(...observer.takeRecords());
      observer.disconnect();
    },
  };
}

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function mountTemplate(node: Node): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.appendChild(node);
  return host;
}

describe('grouped watcher per-binding memo (CQ-03)', () => {
  it('changing a text binding does not re-set sibling attributes', async () => {
    const cls = state('a');
    const title = state('t');
    const label = state('one');
    const root = mountTemplate(
      html`<div class=${() => cls()} title=${() => title()}><span>${() => label()}</span></div>`,
    );
    const div = root.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('a');
    const watch = attributeMutations(root);
    label('two');
    await tick();
    watch.stop();
    expect(root.querySelector('span')!.textContent).toBe('two');
    expect(watch.records).toEqual([]);
  });

  it('changing one attribute writes only that attribute', async () => {
    const cls = state('a');
    const title = state('t');
    const root = mountTemplate(
      html`<div class=${() => cls()} title=${() => title()}><span>x</span></div>`,
    );
    const watch = attributeMutations(root);
    cls('b');
    await tick();
    watch.stop();
    expect(watch.records.map((r) => r.attributeName)).toEqual(['class']);
    expect(root.querySelector('div')!.getAttribute('class')).toBe('b');
  });

  it('boolean attributes are not toggled when only a sibling changes', async () => {
    const disabled = state(true);
    const label = state('one');
    const root = mountTemplate(
      html`<p><button ?disabled=${() => disabled()}>b</button><span>${() => label()}</span></p>`,
    );
    const watch = attributeMutations(root);
    label('two');
    await tick();
    disabled(1 as unknown as boolean); // still truthy: no write
    await tick();
    watch.stop();
    expect(watch.records).toEqual([]);
    disabled(false);
    await tick();
    expect(root.querySelector('button')!.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the typed value and selection of a focused input when a sibling changes', async () => {
    const value = state('initial');
    const label = state('one');
    const root = mountTemplate(
      html`<form><input .value=${() => value()} /><span>${() => label()}</span></form>`,
    );
    const input = root.querySelector('input')!;
    expect(input.value).toBe('initial');
    input.focus();
    input.value = 'user typing';
    input.setSelectionRange(2, 6);
    label('two');
    await tick();
    expect(input.value).toBe('user typing');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(document.activeElement).toBe(input);
    // The binding's own change still writes.
    value('reset');
    await tick();
    expect(input.value).toBe('reset');
  });

  it('first run writes even when the accessor returns undefined (sentinel)', () => {
    const root = mountTemplate(
      html`<div title=${() => undefined} data-x=${() => 'x'}><span>${() => undefined}</span></div>`,
    );
    const div = root.querySelector('div')!;
    expect(div.hasAttribute('title')).toBe(false);
    expect(div.getAttribute('data-x')).toBe('x');
    expect(root.querySelector('span')!.textContent).toBe('');
  });

  it('hydration applies the memo too', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = '<p class="a"><!--[-->one<!--]--></p>';
    const p = host.firstChild as HTMLElement;
    const cls = state('a');
    const label = state('one');
    hydrate(host, () => html`<p class=${() => cls()}>${() => label()}</p>`);
    expect(host.firstChild).toBe(p);
    const watch = attributeMutations(host);
    label('two');
    await tick();
    watch.stop();
    expect(p.textContent).toBe('two');
    expect(watch.records).toEqual([]);
    cls('b');
    await tick();
    expect(p.getAttribute('class')).toBe('b');
  });
});
