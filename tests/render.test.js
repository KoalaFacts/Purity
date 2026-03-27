import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/render.ts';
import { state } from '../src/signals.ts';

describe('html tagged template', () => {
  it('creates a DocumentFragment from static HTML', () => {
    const fragment = html`<p>Hello World</p>`;
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(fragment.querySelector('p').textContent).toBe('Hello World');
  });

  it('interpolates static string values', () => {
    const name = 'Purity';
    const fragment = html`<p>Hello ${name}</p>`;
    expect(fragment.querySelector('p').textContent).toBe('Hello Purity');
  });

  it('interpolates static number values', () => {
    const fragment = html`<span>${42}</span>`;
    expect(fragment.querySelector('span').textContent).toBe('42');
  });

  it('inserts DOM nodes directly', () => {
    const child = document.createElement('strong');
    child.textContent = 'bold';
    const fragment = html`<p>Some ${child} text</p>`;
    expect(fragment.querySelector('strong').textContent).toBe('bold');
  });

  it('inserts arrays of values', () => {
    const items = [document.createElement('li'), document.createElement('li')];
    items[0].textContent = 'A';
    items[1].textContent = 'B';

    const fragment = html`<ul>${items}</ul>`;
    const lis = fragment.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('A');
    expect(lis[1].textContent).toBe('B');
  });

  it('handles null/false values by rendering nothing', () => {
    const fragment = html`<div>${null}${false}</div>`;
    const div = fragment.querySelector('div');
    expect(div.textContent.trim()).toBe('');
  });

  it('creates reactive text bindings with functions', async () => {
    const count = state(0);
    const fragment = html`<p>${() => count()}</p>`;

    // Append to document for effects to work
    document.body.appendChild(fragment);
    const p = document.body.querySelector('p');

    expect(p.textContent).toBe('0');

    count(5);
    await new Promise((r) => queueMicrotask(r));
    expect(p.textContent).toBe('5');

    // Cleanup
    p.remove();
  });

  it('binds event handlers with @event syntax', () => {
    const handler = vi.fn();
    const fragment = html`<button @click=${handler}>Click</button>`;
    document.body.appendChild(fragment);

    const btn = document.body.querySelector('button');
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    btn.remove();
  });

  it('creates multiple elements', () => {
    const fragment = html`
      <h1>Title</h1>
      <p>Paragraph</p>
    `;
    expect(fragment.querySelector('h1').textContent).toBe('Title');
    expect(fragment.querySelector('p').textContent).toBe('Paragraph');
  });

  it('handles nested html templates', () => {
    const inner = html`<span>inner</span>`;
    const outer = html`<div>${inner}</div>`;
    expect(outer.querySelector('div span').textContent).toBe('inner');
  });
});
