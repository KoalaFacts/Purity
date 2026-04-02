import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { state } from '../src/signals.ts';

// Helper: wrap result in a container for querying
function render(result) {
  const container = document.createElement('div');
  container.appendChild(result instanceof Node ? result : document.createTextNode(String(result)));
  return container;
}

describe('html tagged template', () => {
  it('creates DOM from static HTML', () => {
    const result = html`<p>Hello World</p>`;
    const c = render(result);
    expect(c.querySelector('p').textContent).toBe('Hello World');
  });

  it('interpolates static string values', () => {
    const name = 'Purity';
    const c = render(html`<p>Hello ${name}</p>`);
    expect(c.querySelector('p').textContent).toBe('Hello Purity');
  });

  it('interpolates static number values', () => {
    const c = render(html`<span>${42}</span>`);
    const span = c.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('42');
  });

  it('inserts DOM nodes directly', () => {
    const child = document.createElement('strong');
    child.textContent = 'bold';
    const c = render(html`<p>Some ${child} text</p>`);
    const strong = c.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  it('inserts arrays of values', () => {
    const items = [document.createElement('li'), document.createElement('li')];
    items[0].textContent = 'A';
    items[1].textContent = 'B';

    const c = render(html`<ul>${items}</ul>`);
    const lis = c.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('A');
    expect(lis[1].textContent).toBe('B');
  });

  it('handles null/false values by rendering nothing', () => {
    const c = render(html`<div>${undefined}${false}</div>`);
    expect(c.querySelector('div').textContent.trim()).toBe('');
  });

  it('creates reactive text bindings with functions', async () => {
    const count = state(0);
    const result = html`<p>${() => count()}</p>`;

    document.body.appendChild(result);
    const p = document.body.querySelector('p');

    expect(p.textContent).toBe('0');

    count(5);
    await new Promise((r) => queueMicrotask(r));
    expect(p.textContent).toBe('5');

    p.remove();
  });

  it('binds event handlers with @event syntax', () => {
    const handler = vi.fn();
    const result = html`<button @click=${handler}>Click</button>`;
    document.body.appendChild(result);

    const btn = document.body.querySelector('button');
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);

    btn.remove();
  });

  it('creates multiple elements', () => {
    const c = render(html`
      <h1>Title</h1>
      <p>Paragraph</p>
    `);
    expect(c.querySelector('h1').textContent).toBe('Title');
    expect(c.querySelector('p').textContent).toBe('Paragraph');
  });

  it('handles nested html templates', () => {
    const inner = html`<span>inner</span>`;
    const c = render(html`<div>${inner}</div>`);
    expect(c.querySelector('div span').textContent).toBe('inner');
  });
});
