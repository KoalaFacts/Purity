import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { hydrate, mount, onDestroy, onDispose, onError, onMount } from '../src/component.ts';
import { resource } from '../src/resource.ts';
import { primeHydrationCache } from '../src/ssr-context.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

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

  it('a child mount() whose render throws is not retained by the parent (audit MED component.ts:509)', () => {
    // Nested child throws during render: its error bubbles to the parent and
    // the failed child ctx must not linger in parent.children. We can't peek
    // the internal array, so assert the observable contract: the parent
    // unmount only tears down the surviving good child once, and never throws
    // re-processing a stale failed child.
    const outer = document.createElement('div');
    const order: string[] = [];
    const errors: string[] = [];

    const { unmount } = mount(() => {
      onError((err: Error) => errors.push(err.message));
      // Failed child — bubbles 'boom' to the parent's onError.
      mount(() => {
        onDestroy(() => order.push('bad-destroyed'));
        throw new Error('boom');
      }, document.createElement('div'));
      // Surviving child.
      mount(() => {
        onDestroy(() => order.push('good-destroyed'));
        return html`<p>good</p>`;
      }, document.createElement('div'));
      return html`<p>outer</p>`;
    }, outer);

    expect(errors).toEqual(['boom']);
    expect(() => unmount()).not.toThrow();
    // Only the good child's destroy ran — the failed child was dropped, not
    // re-walked by the parent during teardown.
    expect(order).toEqual(['good-destroyed']);
  });
});

describe('hydrate — walker fallback cleanup (audit HIGH component.ts:359)', () => {
  let host: HTMLElement;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    primeHydrationCache([]);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    host.remove();
    errorSpy.mockRestore();
  });

  it('runs the failed render disposers before falling back to fresh mount', async () => {
    // SSR sent <p>plain</p> — no `<!--[-->` marker — but the template has a
    // reactive slot, so inflateDeferred() crashes and the hydrator falls back
    // to a fresh mount(). A disposer registered during the failed render must
    // still fire; otherwise its (live watch/resource) subscription leaks.
    host.innerHTML = '<p>plain</p>';
    let disposed = false;
    let destroyed = false;

    hydrate(host, () => {
      onDispose(() => {
        disposed = true;
      });
      onDestroy(() => {
        destroyed = true;
      });
      return html`<p>${() => 'client'}</p>`;
    });

    await tick();
    // Recovery happened (fresh client content rendered).
    expect(host.textContent).toBe('client');
    // The orphaned render's disposers + destroy callbacks ran during teardown
    // instead of leaking on the abandoned context.
    expect(disposed).toBe(true);
    expect(destroyed).toBe(true);
  });

  it('disposes the failed render context exactly once (no double teardown)', async () => {
    host.innerHTML = '<p>plain</p>';
    let disposeCount = 0;

    hydrate(host, () => {
      onDispose(() => {
        disposeCount++;
      });
      return html`<p>${() => 'x'}</p>`;
    });

    await tick();
    expect(disposeCount).toBe(1);
  });
});

describe('hydrate — multi-root per-boundary cache scoping (audit HIGH component.ts:442)', () => {
  let hostA: HTMLElement;
  let hostB: HTMLElement;

  beforeEach(() => {
    hostA = document.createElement('div');
    hostB = document.createElement('div');
    document.body.append(hostA, hostB);
    primeHydrationCache([]);
  });

  afterEach(() => {
    hostA.remove();
    hostB.remove();
    primeHydrationCache([]);
  });

  it("keeps each root's in-container per-boundary script for its own hydrate()", async () => {
    // Two independent islands. After streaming swap, each boundary's
    // `__purity_resources_N__` script lands INSIDE the root it belongs to
    // (purity_swap insertBefore at the in-root boundary marker). The first
    // hydrate() must not consume/delete the second root's script.
    hostA.innerHTML =
      '<p><!--[-->A<!--]--></p>' +
      '<script type="application/json" id="__purity_resources_1__">{"keyed":{"a":"A-primed"}}</script>';
    hostB.innerHTML =
      '<p><!--[-->B<!--]--></p>' +
      '<script type="application/json" id="__purity_resources_2__">{"keyed":{"b":"B-primed"}}</script>';

    let fetchesA = 0;
    let fetchesB = 0;

    hydrate(hostA, () => {
      const r = resource(
        () => {
          fetchesA++;
          return Promise.resolve('A-fetch');
        },
        { key: 'a' },
      );
      return html`<p>${() => r() ?? '?'}</p>`;
    });

    // The second root's script must survive the first hydrate().
    expect(hostB.querySelector('script#__purity_resources_2__')).not.toBeNull();

    hydrate(hostB, () => {
      const r = resource(
        () => {
          fetchesB++;
          return Promise.resolve('B-fetch');
        },
        { key: 'b' },
      );
      return html`<p>${() => r() ?? '?'}</p>`;
    });

    await tick();

    // Each root primed from its own boundary script — no live fetches.
    expect(hostA.textContent).toBe('A-primed');
    expect(hostB.textContent).toBe('B-primed');
    expect(fetchesA).toBe(0);
    expect(fetchesB).toBe(0);
  });
});
