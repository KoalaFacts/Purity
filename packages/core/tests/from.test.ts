import { getCurrentContext, state, watch } from '@purityjs/signals';
import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { each, mount } from '../src/index.ts';
import { from } from '../src/from.ts';
import { getOwner, root, runWithOwner } from '../src/owner.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

/** A minimal push source: listeners plus counters for subscribe/unsubscribe. */
function feed<T>() {
  const listeners = new Set<(v: T) => void>();
  const counts = { subscribed: 0, unsubscribed: 0 };
  return {
    counts,
    emit(v: T) {
      for (const l of [...listeners]) l(v);
    },
    get size() {
      return listeners.size;
    },
    subscribe(set: (v: T) => void) {
      counts.subscribed++;
      listeners.add(set);
      return () => {
        counts.unsubscribed++;
        listeners.delete(set);
      };
    },
  };
}

describe('from() external sources (SV2-017 slice 2)', () => {
  it('throws outside any owner with a hint', () => {
    const f = feed<number>();
    expect(() => from(f.subscribe)).toThrow(/from\(\) needs an owner/);
    expect(f.counts.subscribed).toBe(0);
  });

  it('drives a component template and unsubscribes exactly once on unmount', async () => {
    const f = feed<number>();
    const App = () => {
      const price = from(f.subscribe, 0);
      return html`<p>${() => price()}</p>`;
    };
    const host = document.createElement('div');
    const { unmount } = mount(App, host);
    expect(host.textContent).toBe('0');
    f.emit(5);
    await tick();
    expect(host.textContent).toBe('5');

    unmount();
    expect(f.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
    expect(f.size).toBe(0);
  });

  it('a value set synchronously during subscribe (store contract) is the first value', () => {
    let read: (() => string | undefined) | null = null;
    root((dispose) => {
      read = from<string>((set) => {
        set('ready');
        return () => {};
      });
      expect(read()).toBe('ready');
      dispose();
    });
    expect(read!()).toBe('ready');
  });

  it('is undefined until the first value without an initial value', () => {
    root((dispose) => {
      const f = feed<number>();
      const v = from(f.subscribe);
      expect(v()).toBeUndefined();
      f.emit(1);
      expect(v()).toBe(1);
      dispose();
    });
  });

  it('a superseded effect run releases its subscription before the next run subscribes', async () => {
    const f = feed<number>();
    const id = state(1);
    const log: string[] = [];
    const dispose = root((d) => {
      watch(() => {
        const n = id();
        from((set) => {
          log.push(`sub ${n}`);
          const off = f.subscribe(set);
          return () => {
            log.push(`unsub ${n}`);
            off();
          };
        });
      });
      return d;
    });
    id.set(2);
    await tick();
    expect(f.size).toBe(1);
    dispose();
    expect(log).toEqual(['sub 1', 'unsub 1', 'sub 2', 'unsub 2']);
    expect(f.size).toBe(0);
  });

  it('a removed each() row releases its subscription', async () => {
    const f = feed<string>();
    const rows = state([1, 2]);
    const App = () =>
      html`<ul>
        ${each(
          rows,
          (n) => {
            const msg = from(f.subscribe, '-');
            return html`<li>${() => `${n()}${msg()}`}</li>`;
          },
          (n) => n,
        )}
      </ul>`;
    const host = document.createElement('div');
    const { unmount } = mount(App, host);
    expect(f.size).toBe(2);
    rows.set([1]);
    await tick();
    expect(f.counts.unsubscribed).toBe(1);
    f.emit('!');
    await tick();
    expect(host.querySelector('ul')!.textContent!.trim()).toBe('1!');
    unmount();
    expect(f.counts).toEqual({ subscribed: 2, unsubscribed: 2 });
  });

  it('ignores values pushed after release and stores function values as-is', () => {
    let push: ((v: () => string) => void) | null = null;
    let read: (() => (() => string) | undefined) | null = null;
    root((dispose) => {
      read = from<() => string>((set) => {
        push = set;
      });
      const fn = () => 'kept';
      push!(fn);
      expect(read()).toBe(fn);
      dispose();
    });
    push!(() => 'late');
    expect(read!()!()).toBe('kept');
  });

  it('reads inside subscribe do not subscribe the calling computation', async () => {
    const outer = state(0);
    let runs = 0;
    const dispose = root((d) => {
      watch(() => {
        runs++;
        from(() => {
          outer();
        });
      });
      return d;
    });
    outer.set(1);
    await tick();
    expect(runs).toBe(1);
    dispose();
  });

  it('created later through runWithOwner on a dead owner is released at once', () => {
    const f = feed<number>();
    let owner: ReturnType<typeof getOwner> = null;
    root((dispose) => {
      owner = getOwner();
      dispose();
    });
    runWithOwner(owner!, () => from(f.subscribe, 0));
    expect(f.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
  });

  it('a throwing subscribe propagates and registers nothing', () => {
    const owner = { disposers: null } as { disposers: (() => void)[] | null };
    let release: (() => void) | null = null;
    root((dispose) => {
      release = dispose;
      const scope = getCurrentContext() as typeof owner;
      expect(() =>
        from(() => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
      owner.disposers = scope.disposers ?? null;
    });
    expect(owner.disposers).toBeNull();
    release!();
  });

  it('created on a root already released inside its own fn is released at once', () => {
    const f = feed<number>();
    root((dispose) => {
      dispose();
      from(f.subscribe, 0);
    });
    expect(f.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
    expect(f.size).toBe(0);
  });
});
