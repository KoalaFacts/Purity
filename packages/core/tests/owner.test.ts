import { compute, state, watch } from '@purityjs/signals';
import { describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { component, each, mount, onDestroy, onDispose, onError } from '../src/index.ts';
import { getOwner, root, runWithOwner } from '../src/owner.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('getOwner / runWithOwner (SV2-017)', () => {
  it('returns null outside any owner', () => {
    expect(getOwner()).toBeNull();
  });

  it('work created in a later callback is disposed with the captured component', async () => {
    const count = state(0);
    const seen: number[] = [];
    let owner: ReturnType<typeof getOwner> = null;
    const App = () => {
      owner = getOwner();
      return html`<p>app</p>`;
    };
    const host = document.createElement('div');
    const { unmount } = mount(App, host);
    expect(owner).not.toBeNull();

    // A later callback (timer, subscription, promise) re-enters the owner.
    await tick();
    runWithOwner(owner!, () => {
      watch(count, (v) => seen.push(v));
    });
    count.set(1);
    await tick();
    expect(seen).toEqual([1]);

    unmount();
    count.set(2);
    await tick();
    expect(seen).toEqual([1]);
  });

  it('errors from re-entered work reach the component onError', async () => {
    const s = state(0);
    const errors: unknown[] = [];
    let owner: ReturnType<typeof getOwner> = null;
    const App = () => {
      onError((e) => errors.push(e));
      owner = getOwner();
      return html`<p>app</p>`;
    };
    const { unmount } = mount(App, document.createElement('div'));
    runWithOwner(owner!, () => {
      watch(s, () => {
        throw new Error('late');
      });
    });
    s.set(1);
    await tick();
    expect(errors.map((e) => (e as Error).message)).toEqual(['late']);
    unmount();
  });

  it('an each() row owner releases late work when the row is removed', async () => {
    const items = state([1, 2]);
    const owners = new Map<number, NonNullable<ReturnType<typeof getOwner>>>();
    const App = () =>
      html`<ul>
        ${each(
          items,
          (item) => {
            owners.set(item(), getOwner()!);
            return html`<li>${item}</li>`;
          },
          (n) => n,
        )}
      </ul>`;
    const { unmount } = mount(App, document.createElement('div'));
    const cleanup = vi.fn();
    runWithOwner(owners.get(2)!, () => onDispose(cleanup));
    items.set([1]);
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(owners.get(2)!.alive).toBe(false);
    expect(owners.get(1)!.alive).toBe(true);
    unmount();
  });

  it('returns the callback result and keeps the caller untracked', async () => {
    const outer = state(0);
    const inner = state(0);
    let runs = 0;
    const dispose = root((dispose) => {
      const owner = getOwner()!;
      watch(() => {
        outer();
        runs++;
        expect(runWithOwner(owner, () => inner() + 41)).toBe(41);
      });
      return dispose;
    });
    expect(runs).toBe(1);
    inner.set(1);
    await tick();
    expect(runs).toBe(1);
    outer.set(1);
    await tick();
    expect(runs).toBe(2);
    dispose();
  });

  it('work bound to a dead owner is disposed at once, never leaked', () => {
    let owner: ReturnType<typeof getOwner> = null;
    const dispose = root((dispose) => {
      owner = getOwner();
      return dispose;
    });
    dispose();
    const cleanup = vi.fn();
    const count = state(0);
    const effect = vi.fn();
    const result = runWithOwner(owner!, () => {
      onDispose(cleanup);
      watch(() => effect(count()));
      return 'ran';
    });
    expect(result).toBe('ran');
    expect(cleanup).toHaveBeenCalledTimes(1);
    effect.mockClear();
    count.set(1);
    expect(effect).not.toHaveBeenCalled();
  });

  it('a destroyed component owner is treated as dead', () => {
    let owner: ReturnType<typeof getOwner> = null;
    const Card = component('p-owner-dead', () => {
      owner = getOwner();
      return html`<span>x</span>`;
    });
    const host = document.createElement('div');
    const { unmount } = mount(() => html`${Card({})}`, host);
    unmount();
    const cleanup = vi.fn();
    runWithOwner(owner!, () => onDispose(cleanup));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('an effect run is the owner until its next run', async () => {
    const trigger = state(0);
    const owners: NonNullable<ReturnType<typeof getOwner>>[] = [];
    const dispose = root((dispose) => {
      watch(() => {
        trigger();
        owners.push(getOwner()!);
      });
      return dispose;
    });
    const cleanup = vi.fn();
    runWithOwner(owners[0], () => onDispose(cleanup));
    expect(cleanup).not.toHaveBeenCalled();
    trigger.set(1);
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    // The first run's handle is dead; the second run's is a new live handle.
    const late = vi.fn();
    runWithOwner(owners[0], () => onDispose(late));
    expect(late).toHaveBeenCalledTimes(1);
    expect(owners[1]).not.toBe(owners[0]);
    dispose();
  });

  it('getOwner() returns the same handle for repeated calls in one owner', () => {
    root((dispose) => {
      expect(getOwner()).toBe(getOwner());
      dispose();
    });
  });

  it('re-entering another owner from inside a component does not attach work to the caller', async () => {
    const count = state(0);
    const seen: number[] = [];
    let release!: () => void;
    const detached = root((dispose) => {
      release = dispose;
      return getOwner()!;
    });
    const App = () => {
      runWithOwner(detached, () => {
        watch(count, (v) => seen.push(v));
        // Component-only hooks see no component through a root owner.
        onDestroy(() => seen.push(-1));
      });
      return html`<p>app</p>`;
    };
    const { unmount } = mount(App, document.createElement('div'));
    unmount();
    count.set(1);
    await tick();
    expect(seen).toEqual([1]);
    release();
    count.set(2);
    await tick();
    expect(seen).toEqual([1]);
  });

  it('a throwing callback propagates and leaves the context stack intact', () => {
    root((dispose) => {
      const owner = getOwner()!;
      expect(() =>
        runWithOwner(owner, () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(getOwner()).toBe(owner);
      dispose();
    });
  });

  it('rejects a value that is not an owner handle', () => {
    expect(() => runWithOwner({} as never, () => 1)).toThrow(TypeError);
  });
});

describe('root (SV2-017)', () => {
  it('is detached from the caller and released exactly once by dispose', async () => {
    const count = state(0);
    const seen: number[] = [];
    const cleanup = vi.fn();
    let disposeCache!: () => void;
    const App = () => {
      root((dispose) => {
        disposeCache = dispose;
        watch(count, (v) => seen.push(v));
        onDispose(cleanup);
      });
      return html`<p>app</p>`;
    };
    const host = document.createElement('div');
    const { unmount } = mount(App, host);
    unmount();
    // The caller's unmount does not release the detached root.
    count.set(1);
    await tick();
    expect(seen).toEqual([1]);
    expect(cleanup).not.toHaveBeenCalled();

    disposeCache();
    disposeCache();
    expect(cleanup).toHaveBeenCalledTimes(1);
    count.set(2);
    await tick();
    expect(seen).toEqual([1]);
  });

  it('disposes what it created and rethrows when the callback throws', () => {
    const cleanup = vi.fn();
    expect(() =>
      root(() => {
        onDispose(cleanup);
        throw new Error('setup failed');
      }),
    ).toThrow('setup failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not track reads made by the callback', async () => {
    const a = state(0);
    let outerRuns = 0;
    const stop = watch(() => {
      outerRuns++;
      root((dispose) => {
        a();
        dispose();
      });
    });
    a.set(1);
    await tick();
    expect(outerRuns).toBe(1);
    stop();
  });

  it('records nested cleanup order: registration order (FIFO) within one owner', () => {
    const order: string[] = [];
    const dispose = root((dispose) => {
      onDispose(() => order.push('parent A'));
      const releaseChild = root((release) => {
        onDispose(() => order.push('child A'));
        onDispose(() => order.push('child B'));
        return release;
      });
      // A root is detached: the parent releases it only when told to.
      onDispose(releaseChild);
      onDispose(() => order.push('parent B'));
      return dispose;
    });
    dispose();
    expect(order).toEqual(['parent A', 'child A', 'child B', 'parent B']);
  });

  it('a compute created in a root stays live until the root is disposed', () => {
    const n = state(2);
    let double!: () => number;
    const dispose = root((dispose) => {
      double = compute(() => n() * 2);
      return dispose;
    });
    expect(double()).toBe(4);
    n.set(3);
    expect(double()).toBe(6);
    dispose();
  });
});

describe('owner edge cases from verifier round 1 (SV2-017)', () => {
  it('a re-entered each() row owner still routes hooks and errors to its component', async () => {
    const s = state(0);
    const items = state([1]);
    const log: string[] = [];
    let rowOwner: ReturnType<typeof getOwner> = null;
    const App = () => {
      onError((e) => log.push('onError:' + (e as Error).message));
      return html`<ul>
        ${each(
          items,
          (item) => {
            rowOwner = getOwner();
            return html`<li>${item}</li>`;
          },
          (n) => n,
        )}
      </ul>`;
    };
    const { unmount } = mount(App, document.createElement('div'));
    runWithOwner(rowOwner!, () => {
      onDestroy(() => log.push('destroyed'));
      watch(s, () => {
        throw new Error('row-late');
      });
    });
    s.set(1);
    await tick();
    expect(log).toEqual(['onError:row-late']);
    unmount();
    expect(log).toEqual(['onError:row-late', 'destroyed']);
  });

  it('work re-entered into a root while it is being disposed is released, not leaked', () => {
    const late = vi.fn();
    let owner: ReturnType<typeof getOwner> = null;
    const dispose = root((dispose) => {
      onDispose(() => runWithOwner(owner!, () => onDispose(late)));
      owner = getOwner();
      return dispose;
    });
    dispose();
    expect(late).toHaveBeenCalledTimes(1);
    expect(owner!.alive).toBe(false);
  });

  it('a watch re-entered into a row from its own cleanup does not outlive the row', async () => {
    const items = state([1]);
    const s = state(0);
    const seen: number[] = [];
    const App = () =>
      html`<ul>
        ${each(
          items,
          (item) => {
            onDispose(() => runWithOwner(owner, () => watch(s, (v) => seen.push(v))));
            const owner = getOwner()!;
            return html`<li>${item}</li>`;
          },
          (n) => n,
        )}
      </ul>`;
    const { unmount } = mount(App, document.createElement('div'));
    items.set([]);
    await tick();
    s.set(5);
    await tick();
    expect(seen).toEqual([]);
    unmount();
  });

  it('a root released inside its own callback hands out dead handles', () => {
    const late = vi.fn();
    let owner: ReturnType<typeof getOwner> = null;
    root((dispose) => {
      dispose();
      owner = getOwner();
    });
    expect(owner!.alive).toBe(false);
    runWithOwner(owner!, () => onDispose(late));
    expect(late).toHaveBeenCalledTimes(1);
  });
});
