import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { isHydrating, withHydration } from '../src/compiler/hydrate-runtime.ts';
import { hydrate, mount, onDestroy, onDispose, onError, onMount } from '../src/component.ts';
import { each, inflateDeferredEach, list, type DeferredEach } from '../src/control.ts';
import { ComponentContext, getCurrentContext, popContext, pushContext } from '../src/scope.ts';
import { disposeScope, state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
});

describe('failed component initialization', () => {
  for (const mode of ['mount', 'hydrate'] as const) {
    for (const handled of [true, false]) {
      it(`${mode} releases subscriptions when the render error is ${handled ? 'handled' : 'rethrown'}`, async () => {
        const value = state(0);
        const host = document.createElement('div');
        if (mode === 'hydrate') host.innerHTML = '<p>server</p>';
        let runs = 0;
        let disposals = 0;
        let destroyed = 0;
        const errors: unknown[] = [];
        const failure = new Error('render failed');
        const render = () => {
          if (handled) onError((error) => errors.push(error));
          onDestroy(() => destroyed++);
          stops.push(
            watch(() => {
              value();
              runs++;
            }),
          );
          onDispose(() => {
            disposals++;
          });
          throw failure;
        };
        const start = () => (mode === 'mount' ? mount(render, host) : hydrate(host, render));
        if (handled) {
          const result = start();
          result.unmount();
          result.unmount();
          expect(errors).toEqual([failure]);
        } else expect(start).toThrow(failure);
        value(1);
        await tick();
        expect(runs).toBe(1);
        expect(disposals).toBe(1);
        expect(destroyed).toBe(0);
        expect(getCurrentContext()).toBeNull();
        expect(isHydrating()).toBe(false);
      });
    }

    it(`${mode} skips the failed child's destroy hook when its error handler unmounts the parent`, async () => {
      let destroyed = 0;
      let disposals = 0;
      const errors: unknown[] = [];
      const parent = mount(() => {
        onError(() => parent.unmount());
        onMount(() => {
          const render = () => {
            onDestroy(() => destroyed++);
            onDispose(() => disposals++);
            throw new Error('child failed');
          };
          const host = document.createElement('div');
          if (mode === 'hydrate') host.innerHTML = '<p>server</p>';
          try {
            if (mode === 'hydrate') hydrate(host, render);
            else mount(render, host);
          } catch (error) {
            // Error propagation must not bypass scope cleanup. The parent can
            // itself throw after its error handler tears down its callbacks.
            errors.push(error);
          }
        });
        return document.createElement('div');
      }, document.createElement('div'));
      await tick();
      parent.unmount();
      expect(destroyed).toBe(0);
      expect(disposals).toBe(1);
      expect(errors.every((error) => error instanceof Error)).toBe(true);
    });

    it(`${mode} tears down completed child mounts when its own render fails`, async () => {
      const host = document.createElement('div');
      if (mode === 'hydrate') host.innerHTML = '<p>server</p>';
      const childHost = document.createElement('div');
      const value = state(0);
      let runs = 0;
      let disposals = 0;
      let mounted = 0;
      let destroyed = 0;
      const render = () => {
        onError(() => {});
        mount(() => {
          onDestroy(() => destroyed++);
          stops.push(
            watch(() => {
              value();
              runs++;
            }),
          );
          onDispose(() => {
            disposals++;
          });
          onMount(() => {
            mounted++;
          });
          return document.createElement('p');
        }, childHost);
        throw new Error('parent failed');
      };
      const result = mode === 'mount' ? mount(render, host) : hydrate(host, render);
      result.unmount();
      value(1);
      await tick();
      expect(runs).toBe(1);
      expect(disposals).toBe(1);
      expect(mounted).toBe(0);
      expect(destroyed).toBe(1);
      expect(childHost.childNodes).toHaveLength(0);
    });
  }

  it('releases the failed scope even when its onError callback throws', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let disposals = 0;
    mount(() => {
      onDispose(() => {
        disposals++;
      });
      onError(() => {
        throw new Error('error handler failed');
      });
      throw new Error('render failed');
    }, document.createElement('div'));
    expect(errorLog).toHaveBeenCalledWith('[Purity] Error in onError handler:', expect.any(Error));
    expect(disposals).toBe(1);
  });
});

describe('failed list row initialization', () => {
  it('stops a standalone virtual list source watch when its first row fails', async () => {
    const items = state([1]);
    let sourceRuns = 0;
    expect(() =>
      each(
        () => {
          sourceRuns++;
          return items();
        },
        () => {
          throw new Error('standalone row failed');
        },
        { virtual: true },
      ),
    ).toThrow('standalone row failed');
    items([]);
    await tick();
    expect(sourceRuns).toBe(1);
  });

  for (const virtual of [false, true]) {
    for (const failedRow of [1, 2]) {
      it(`releases row ${failedRow} and prior rows in an initial ${virtual ? 'virtual' : 'ordinary'} list`, async () => {
        const value = state(0);
        const runs: number[] = [];
        const disposed: number[] = [];
        const host = document.createElement('div');
        const result = mount(() => {
          onError(() => {});
          return each(
            [1, 2],
            (item) => {
              const id = item();
              stops.push(
                watch(() => {
                  value();
                  runs.push(id);
                }),
              );
              onDispose(() => {
                disposed.push(id);
              });
              if (id === failedRow) throw new Error('row failed');
              return document.createElement('li');
            },
            (item) => item,
            { virtual },
          ) as DocumentFragment;
        }, host);
        result.unmount();
        value(1);
        await tick();
        const expected = failedRow === 1 ? [1] : [1, 2];
        expect(runs).toEqual(expected);
        expect(disposed.toSorted()).toEqual(expected);
        expect(getCurrentContext()).toBeNull();
      });
    }
  }

  for (const virtual of [false, true]) {
    it(`owns reactive work created by failed ${virtual ? 'virtual' : 'ordinary'} row cleanup`, async () => {
      const value = state(0);
      let runs = 0;
      const result = mount(() => {
        onError(() => {});
        return each(
          [1],
          () => {
            onDispose(() => {
              stops.push(
                watch(() => {
                  value();
                  runs++;
                }),
              );
            });
            throw new Error('row failed');
          },
          { virtual },
        );
      }, document.createElement('div'));
      result.unmount();
      expect(runs).toBe(1);
      value(1);
      await tick();
      expect(runs).toBe(1);
      expect(getCurrentContext()).toBeNull();
    });
  }

  for (const kind of ['each', 'list'] as const) {
    for (const failure of ['key', 'create'] as const) {
      it(`${kind} preserves reused row data when later ${failure} planning throws`, async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        type Item = { id: number; label: string };
        const items = state<Item[]>([{ id: 1, label: 'old' }]);
        const key = (item: Item) => {
          if (item.id === 3 && failure === 'key') throw new Error('key failed');
          return item.id;
        };
        const text = (item: Item) => {
          if (item.id === 3 && failure === 'create') throw new Error('create failed');
          return item.label;
        };
        const host = document.createElement('div');
        const result = mount(
          () =>
            kind === 'list'
              ? list('li', items, text, key)
              : (each(
                  items,
                  (item) => {
                    text(item());
                    return html`<li>${() => item().label}</li>`;
                  },
                  key,
                ) as DocumentFragment),
          host,
        );
        const original = host.querySelector('li');
        items([
          { id: 1, label: 'changed' },
          { id: 2, label: 'second' },
          { id: 3, label: 'bad' },
        ]);
        await tick();
        expect(host.textContent).toBe('old');
        expect(host.querySelector('li')).toBe(original);
        items([{ id: 1, label: 'recovered' }]);
        await tick();
        expect(host.textContent).toBe('recovered');
        expect(host.querySelector('li')).toBe(original);
        result.unmount();
      });
    }
  }

  it('keeps first-occurrence source indices for reused rows after duplicate keys', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = state([
      { id: 1, label: 'one' },
      { id: 2, label: 'two' },
    ]);
    const host = document.createElement('div');
    const result = mount(
      () =>
        list(
          'li',
          items,
          (item, index) => `${item.label}:${index};`,
          (item) => item.id,
        ),
      host,
    );
    const rows = Array.from(host.querySelectorAll('li'));
    items([
      { id: 1, label: 'first' },
      { id: 1, label: 'duplicate' },
      { id: 2, label: 'second' },
    ]);
    await tick();
    expect(host.textContent).toBe('first:0;second:2;');
    expect(Array.from(host.querySelectorAll('li'))).toEqual(rows);
    result.unmount();
  });

  for (const failureKind of ['map', 'key'] as const) {
    it(`rolls back new rows after an update ${failureKind} error and keeps existing rows usable`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const items = state([1]);
      const value = state(0);
      const runs: number[] = [];
      const disposed: number[] = [];
      const host = document.createElement('div');
      const result = mount(
        () =>
          each(
            items,
            (item) => {
              const id = item();
              stops.push(
                watch(() => {
                  value();
                  runs.push(id);
                }),
              );
              onDispose(() => {
                disposed.push(id);
              });
              if (id === 3 && failureKind === 'map') throw new Error('map failed');
              const row = document.createElement('li');
              row.textContent = String(id);
              return row;
            },
            (item) => {
              if (item === 3 && failureKind === 'key') throw new Error('key failed');
              return item;
            },
          ) as DocumentFragment,
        host,
      );
      const original = host.querySelector('li');
      items([1, 2, 3]);
      await tick();
      expect(disposed.toSorted()).toEqual(failureKind === 'map' ? [2, 3] : [2]);
      expect(host.querySelector('li')).toBe(original);
      expect(host.textContent).toBe('1');
      runs.length = 0;
      value(1);
      await tick();
      expect(runs).toEqual([1]);
      items([1, 4]);
      await tick();
      expect(host.textContent).toBe('14');
      expect(host.querySelector('li')).toBe(original);
      result.unmount();
      expect(disposed.toSorted()).toEqual(failureKind === 'map' ? [1, 2, 3, 4] : [1, 2, 4]);
    });
  }

  for (const adopted of [true, false]) {
    it(`releases ${adopted ? 'adopted' : 'fresh'} hydration template bindings after row and fallback failure`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const value = state(0);
      let bindingRuns = 0;
      const host = document.createElement('div');
      host.innerHTML =
        '<ul><!--[--><!--e-->' +
        (adopted ? '<!--er:1--><li><!--[-->0<!--]--></li><!--/er-->' : '') +
        '<!--er:2--><li>2</li><!--/er--><!--/e--><!--]--></ul>';
      const result = hydrate(host, () => {
        onError(() => {});
        return html`<ul>${each(
          [1, 2],
          (item) => {
            if (item() === 2) throw new Error('row failed');
            return html`<li>${() => {
              bindingRuns++;
              return value();
            }}</li>`;
          },
          (item) => item,
        )}</ul>`;
      });
      result.unmount();
      expect(bindingRuns).toBe(2);
      value(1);
      await tick();
      expect(bindingRuns).toBe(2);
      expect(host.childNodes).toHaveLength(0);
      expect(getCurrentContext()).toBeNull();
      expect(isHydrating()).toBe(false);
    });
  }

  it('releases adopted hydration rows and the throwing row without leaving hydration active', async () => {
    const value = state(0);
    const runs: number[] = [];
    const disposed: number[] = [];
    const host = document.createElement('div');
    host.innerHTML =
      '<!--e--><!--er:1--><li><!--[-->1<!--]--></li><!--/er--><!--er:2--><li>2</li><!--/er--><!--/e-->';
    const close = document.createComment(']');
    host.append(close);
    const owner = new ComponentContext();
    pushContext(owner);
    try {
      const deferred = withHydration(() =>
        each(
          [1, 2],
          (item) => {
            const id = item();
            stops.push(
              watch(() => {
                value();
                runs.push(id);
              }),
            );
            onDispose(() => {
              disposed.push(id);
            });
            if (id === 2) throw new Error('hydrated row failed');
            return html`<li>${() => item()}</li>`;
          },
          (item) => item,
        ),
      ) as DeferredEach<number>;
      expect(() =>
        inflateDeferredEach(deferred, Array.from(host.childNodes).slice(0, -1), close),
      ).toThrow('hydrated row failed');
    } finally {
      popContext();
      disposeScope(owner);
    }
    value(1);
    await tick();
    expect(runs).toEqual([1, 2]);
    expect(disposed.toSorted()).toEqual([1, 2]);
    expect(isHydrating()).toBe(false);
    expect(getCurrentContext()).toBeNull();
  });
});
