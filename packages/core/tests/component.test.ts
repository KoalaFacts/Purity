import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount, onDestroy, onDispose, onError, onMount } from '../src/component.ts';

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
  it('calls onMount after DOM insertion', async () => {
    const container = document.createElement('div');
    let mountedEl = null;

    mount(() => {
      onMount(() => {
        mountedEl = container.querySelector('p');
      });
      return html`<p>Mounted</p>`;
    }, container);

    await new Promise((r) => queueMicrotask(r));
    expect(mountedEl).not.toBeNull();
    expect(mountedEl.textContent).toBe('Mounted');
  });

  it('calls onDestroy on unmount', () => {
    const container = document.createElement('div');
    const order = [];

    const { unmount } = mount(() => {
      onDestroy(() => order.push('destroyed'));
      return html`<p>Test</p>`;
    }, container);

    unmount();
    expect(order).toEqual(['destroyed']);
  });

  it('calls onDispose on unmount', () => {
    const container = document.createElement('div');
    let disposed = false;

    const { unmount } = mount(() => {
      onDispose(() => {
        disposed = true;
      });
      return html`<p>Test</p>`;
    }, container);

    expect(disposed).toBe(false);
    unmount();
    expect(disposed).toBe(true);
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
      });
      onDestroy(() => order.push('destroyed'));
      return html`<p>Test</p>`;
    }, container);

    await new Promise((r) => queueMicrotask(r));
    expect(order).toEqual(['mounted']);

    unmount();
    expect(order).toEqual(['mounted', 'destroyed']);
  });

  it('registers onDispose called from inside onMount', async () => {
    const container = document.createElement('div');
    const log: string[] = [];

    const { unmount } = mount(() => {
      onMount(() => {
        log.push('mounted');
        // onDispose called inside onMount must attach to this component's
        // disposers — not silently no-op (regression for the missing
        // pushContext during the onMount queueMicrotask).
        onDispose(() => log.push('disposed'));
      });
      return html`<p>x</p>`;
    }, container);

    await new Promise((r) => queueMicrotask(r));
    expect(log).toEqual(['mounted']);

    unmount();
    expect(log).toEqual(['mounted', 'disposed']);
  });

  it('catches errors thrown in onMount via onError', async () => {
    const container = document.createElement('div');
    const errors: string[] = [];

    mount(() => {
      onError((err: Error) => errors.push(err.message));
      onMount(() => {
        throw new Error('mount-fail');
      });
      return html`<p>x</p>`;
    }, container);

    await new Promise((r) => queueMicrotask(r));
    expect(errors).toEqual(['mount-fail']);
  });

  it('logs onDestroy errors without throwing', () => {
    const container = document.createElement('div');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = mount(() => {
      onDestroy(() => {
        throw new Error('destroy-fail');
      });
      return html`<p>x</p>`;
    }, container);

    expect(() => unmount()).not.toThrow();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('bubbles errors to parent onError handler', () => {
    const container = document.createElement('div');
    const errors: string[] = [];

    mount(() => {
      onError((err: Error) => errors.push(`parent:${err.message}`));
      mount(() => {
        throw new Error('child-fail');
      }, document.createElement('div'));
      return html`<p>x</p>`;
    }, container);

    expect(errors).toEqual(['parent:child-fail']);
  });

  it('rethrows errors with no handler installed', () => {
    expect(() =>
      mount(() => {
        throw new Error('uncaught');
      }, document.createElement('div')),
    ).toThrow('uncaught');
  });

  it('logs error in onError handler itself', () => {
    const container = document.createElement('div');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    mount(() => {
      onError(() => {
        throw new Error('handler-bad');
      });
      throw new Error('original');
    }, container);

    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('logs disposer errors during unmountContext disposal', () => {
    const container = document.createElement('div');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = mount(() => {
      onDispose(() => {
        throw new Error('disposer-bad');
      });
      return html`<p>x</p>`;
    }, container);

    unmount();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('disposal'), expect.any(Error));
    err.mockRestore();
  });

  it('onMount/onDestroy/onDispose/onError outside a component are no-ops', () => {
    expect(() => {
      onMount(() => {});
      onDestroy(() => {});
      onDispose(() => {});
      onError(() => {});
    }).not.toThrow();
  });

  it('mount() handles a render returning a single Node (not fragment)', () => {
    const container = document.createElement('div');
    const { unmount } = mount(() => {
      const el = document.createElement('p');
      el.className = 'mn-single';
      el.textContent = 'hi';
      return el;
    }, container);
    expect(container.querySelector('.mn-single')).not.toBeNull();
    unmount();
    expect(container.querySelector('.mn-single')).toBeNull();
  });

  it('double-unmount is a no-op (re-entry guard)', () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    const { unmount } = mount(() => {
      onDestroy(() => calls.push('d'));
      return html`<p>x</p>`;
    }, container);
    unmount();
    expect(calls).toEqual(['d']);
    // Second unmount: ctx._isDestroyed is true, returns early
    expect(() => unmount()).not.toThrow();
    expect(calls).toEqual(['d']);
  });

  it('runs nested mount under existing context (parent.children)', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    let outerUnmount: (() => void) | null = null;
    const innerOrder: string[] = [];

    outerUnmount = mount(() => {
      mount(() => {
        onDestroy(() => innerOrder.push('inner-destroyed'));
        return html`<p>inner</p>`;
      }, inner);
      return html`<p>outer</p>`;
    }, outer).unmount;

    outerUnmount();
    expect(innerOrder).toEqual(['inner-destroyed']);
  });
});
