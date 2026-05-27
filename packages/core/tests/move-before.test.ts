// Tests for ADR 0037: state-preserving DOM moves via Element.moveBefore +
// connectedMoveCallback. jsdom doesn't ship moveBefore, so CI runs always
// take the insertBefore fallback path. These tests verify:
//
//   1. PurityElement defines connectedMoveCallback so it opts into
//      state-preserving moves on supporting engines (no opt-in = the
//      browser falls back to disconnect+connect, defeating the point).
//   2. The fallback fragment-batching path still produces correct DOM
//      after a reorder — covered indirectly by other each() tests, but
//      re-asserted here for completeness.
//
// The actual moveBefore call site is covered by web-platform-tests in
// real browsers. We don't attempt to simulate it in jsdom; rewiring
// Element.prototype before module init isn't workable through Vitest's
// static import graph.

import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../src/component.ts';
import { each } from '../src/control.ts';
import { component } from '../src/elements.ts';
import { html } from '../src/compiler/compile.ts';
import { state } from '../src/signals.ts';

let tagSeq = 0;
const nextTag = () => `p-mb-${tagSeq++}`;

const tick = () => new Promise((r) => queueMicrotask(r));

describe('connectedMoveCallback opt-in', () => {
  it('is defined on PurityElement so moveBefore preserves CE state', () => {
    const tag = nextTag();
    component(tag, () => html`<div></div>`);
    const cls = customElements.get(tag) as CustomElementConstructor | undefined;
    expect(cls).toBeDefined();
    expect(typeof cls!.prototype.connectedMoveCallback).toBe('function');
  });

  it('can be invoked as a no-op (browser-driven call has no preconditions)', () => {
    const tag = nextTag();
    component(tag, () => html`<span></span>`);
    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = document.body.firstElementChild as HTMLElement & {
      connectedMoveCallback: () => void;
    };
    expect(() => el.connectedMoveCallback()).not.toThrow();
  });
});

describe('each() reorder — fallback path (jsdom has no moveBefore)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reverses a list correctly', async () => {
    const items = state([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(
      () =>
        each(
          items,
          (item) => html`<p>${() => item().label}</p>`,
          (item) => item.id,
        ) as unknown as Node,
      container,
    );

    let texts = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
    expect(texts).toEqual(['A', 'B', 'C']);

    items([
      { id: 'c', label: 'C' },
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A' },
    ]);
    await tick();
    texts = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
    expect(texts).toEqual(['C', 'B', 'A']);
  });

  it('handles the 2-swap fast path correctly', async () => {
    const items = state([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(
      () =>
        each(
          items,
          (item) => html`<p>${() => item().label}</p>`,
          (item) => item.id,
        ) as unknown as Node,
      container,
    );

    items([
      { id: 'a', label: 'A' },
      { id: 'c', label: 'C' },
      { id: 'b', label: 'B' },
      { id: 'd', label: 'D' },
    ]);
    await tick();
    const texts = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
    expect(texts).toEqual(['A', 'C', 'B', 'D']);
  });

  it('preserves the same node references across reorder (no destroy+recreate)', async () => {
    // moveBefore preserves CE state; insertBefore (jsdom path) preserves
    // node identity but tears down CE state. Both, however, keep the
    // *node references* — this is what lets focus/animations survive on
    // moveBefore-capable engines, and is also what makes the LIS reorder
    // a noticeable improvement over naive teardown+rebuild.
    const items = state([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(
      () =>
        each(
          items,
          (item) => html`<p>${() => item().label}</p>`,
          (item) => item.id,
        ) as unknown as Node,
      container,
    );

    const before = Array.from(container.querySelectorAll('p'));
    const beforeById = new Map<string, Element>();
    beforeById.set('A', before[0]);
    beforeById.set('B', before[1]);
    beforeById.set('C', before[2]);

    items([
      { id: 'c', label: 'C' },
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    await tick();

    const after = Array.from(container.querySelectorAll('p'));
    // Same nodes, new order.
    expect(after[0]).toBe(beforeById.get('C'));
    expect(after[1]).toBe(beforeById.get('A'));
    expect(after[2]).toBe(beforeById.get('B'));
  });
});
