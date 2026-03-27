import { describe, expect, it } from 'vitest';
import { html } from '../src/render.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('bind: two-way binding', () => {
  it('binds input value to state', async () => {
    const text = state('hello');
    const fragment = html`<input type="text" bind:value=${text} />`;

    const container = document.createElement('div');
    container.appendChild(fragment);
    const input = container.querySelector('input');

    await tick();
    expect(input.value).toBe('hello');

    // Update state → input updates
    text('world');
    await tick();
    expect(input.value).toBe('world');
  });

  it('binds input events back to state', async () => {
    const text = state('hello');
    const fragment = html`<input type="text" bind:value=${text} />`;

    const container = document.createElement('div');
    container.appendChild(fragment);
    const input = container.querySelector('input');

    await tick();

    // Simulate user typing
    input.value = 'typed';
    input.dispatchEvent(new Event('input'));

    expect(text()).toBe('typed');
  });

  it('binds checkbox checked to state', async () => {
    const checked = state(false);
    const fragment = html`<input type="checkbox" bind:checked=${checked} />`;

    const container = document.createElement('div');
    container.appendChild(fragment);
    const input = container.querySelector('input');

    await tick();
    expect(input.checked).toBe(false);

    // Update state → checkbox updates
    checked(true);
    await tick();
    expect(input.checked).toBe(true);

    // Simulate user click
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    expect(checked()).toBe(false);
  });

  it('binds select value to state', async () => {
    const selected = state('b');
    const fragment = html`
      <select bind:value=${selected}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    `;

    const container = document.createElement('div');
    container.appendChild(fragment);
    const select = container.querySelector('select');

    await tick();
    expect(select.value).toBe('b');

    // Update state
    selected('c');
    await tick();
    expect(select.value).toBe('c');

    // Simulate user change
    select.value = 'a';
    select.dispatchEvent(new Event('input'));
    expect(selected()).toBe('a');
  });
});
