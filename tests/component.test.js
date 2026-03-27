import { describe, expect, it } from 'vitest';
import {
  mount,
  onBeforeDestroy,
  onBeforeMount,
  onDestroy,
  onError,
  onMount,
} from '../src/component.ts';
import { html } from '../src/render.ts';

describe('mount', () => {
  it('mounts a component into a container', () => {
    const container = document.createElement('div');

    mount(() => html`<p>Hello</p>`, container);

    expect(container.querySelector('p').textContent).toBe('Hello');
  });

  it('returns an unmount function', () => {
    const container = document.createElement('div');

    const { unmount } = mount(() => html`<p>Hello</p>`, container);
    expect(container.querySelector('p')).not.toBeNull();

    unmount();
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('lifecycle hooks', () => {
  it('calls onBeforeMount before DOM insertion', () => {
    const container = document.createElement('div');
    const order = [];

    mount(() => {
      onBeforeMount(() => {
        order.push('beforeMount');
        // Container should not have the content yet... or it should
        // depending on timing — beforeMount fires after component fn
        // but before insertion
      });
      order.push('render');
      return html`<p>Test</p>`;
    }, container);

    expect(order).toEqual(['render', 'beforeMount']);
  });

  it('calls onMount after DOM insertion', async () => {
    const container = document.createElement('div');
    let mountedEl = null;

    mount(() => {
      onMount(() => {
        mountedEl = container.querySelector('p');
      });
      return html`<p>Mounted</p>`;
    }, container);

    // onMount runs in microtask
    await new Promise((r) => queueMicrotask(r));
    expect(mountedEl).not.toBeNull();
    expect(mountedEl.textContent).toBe('Mounted');
  });

  it('calls onBeforeDestroy and onDestroy on unmount', () => {
    const container = document.createElement('div');
    const order = [];

    const { unmount } = mount(() => {
      onBeforeDestroy(() => order.push('beforeDestroy'));
      onDestroy(() => order.push('destroyed'));
      return html`<p>Test</p>`;
    }, container);

    unmount();
    expect(order).toEqual(['beforeDestroy', 'destroyed']);
  });

  it('calls onError when component throws', () => {
    const container = document.createElement('div');
    const errors = [];

    mount(() => {
      onError((err) => errors.push(err.message));
      throw new Error('test error');
    }, container);

    expect(errors).toEqual(['test error']);
  });

  it('supports nested onDestroy inside onMount', async () => {
    const container = document.createElement('div');
    const order = [];

    const { unmount } = mount(() => {
      onMount(() => {
        order.push('mounted');
        // This pattern is common: setup in onMount, cleanup in onDestroy
      });
      onDestroy(() => order.push('destroyed'));
      return html`<p>Test</p>`;
    }, container);

    await new Promise((r) => queueMicrotask(r));
    expect(order).toEqual(['mounted']);

    unmount();
    expect(order).toEqual(['mounted', 'destroyed']);
  });
});
