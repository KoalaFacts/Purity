import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount, onDispose, onError } from '../src/component.ts';
import { when } from '../src/control.ts';
import { state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
});

describe('scheduled reactive error ownership', () => {
  it('delivers a later watch failure to its component exactly once', async () => {
    const trigger = state(false);
    const failure = new Error('scheduled watch failed');
    const caught: unknown[] = [];
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = mount(() => {
      onError((error) => caught.push(error));
      watch(() => {
        if (trigger()) throw failure;
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    expect(caught).toEqual([]);
    trigger(true);
    await tick();
    await tick();
    expect(caught).toEqual([failure]);
    expect(reported).not.toHaveBeenCalled();
  });

  it('owns recovery watches and disposal hooks created by its error handler', async () => {
    const fail = state(false);
    const recoveryInput = state(0);
    let recoveryRuns = 0;
    let recoveryCleanups = 0;
    let recoveryDisposals = 0;
    const app = mount(() => {
      onError(() => {
        stops.push(
          watch(() => {
            recoveryInput();
            recoveryRuns++;
            return () => {
              recoveryCleanups++;
            };
          }),
        );
        onDispose(() => recoveryDisposals++);
      });
      watch(() => {
        if (fail()) throw new Error('recover');
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    fail(true);
    await tick();
    expect(recoveryRuns).toBe(1);
    app.unmount();
    expect(recoveryCleanups).toBe(1);
    expect(recoveryDisposals).toBe(1);
    recoveryInput(1);
    await tick();
    expect(recoveryRuns).toBe(1);
  });

  it('owns parent-boundary recovery work until the receiving parent unmounts', async () => {
    const fail = state(false);
    const recoveryInput = state(0);
    let recoveryRuns = 0;
    let recoveryCleanups = 0;
    let recoveryDisposals = 0;
    let stopChild = () => {};
    const app = mount(() => {
      onError(() => {
        stops.push(
          watch(() => {
            recoveryInput();
            recoveryRuns++;
            return () => {
              recoveryCleanups++;
            };
          }),
        );
        onDispose(() => recoveryDisposals++);
      });
      const child = mount(() => {
        watch(() => {
          if (fail()) throw new Error('child failed');
        });
        return document.createTextNode('child');
      }, document.createElement('div'));
      stopChild = child.unmount;
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    fail(true);
    await tick();
    expect(recoveryRuns).toBe(1);
    stopChild();
    expect(recoveryCleanups).toBe(0);
    expect(recoveryDisposals).toBe(0);
    recoveryInput(1);
    await tick();
    expect(recoveryRuns).toBe(2);
    app.unmount();
    expect(recoveryCleanups).toBe(2);
    expect(recoveryDisposals).toBe(1);
    recoveryInput(2);
    await tick();
    expect(recoveryRuns).toBe(2);
  });

  it('retains the live component boundary when a watch stops itself then throws null', async () => {
    const fail = state(false);
    const caught: unknown[] = [];
    let runs = 0;
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = mount(() => {
      onError((error) => caught.push(error));
      const stop = watch(() => {
        runs++;
        if (fail()) {
          stop();
          throw null;
        }
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    fail(true);
    await tick();
    expect(caught).toEqual([null]);
    expect(reported).not.toHaveBeenCalled();
    fail(false);
    await tick();
    expect(runs).toBe(2);
  });

  it('routes a descendant watch created in a later lean branch to the parent boundary', async () => {
    const show = state(false);
    const trigger = state(false);
    const failure = new Error('descendant watch failed');
    const caught: unknown[] = [];
    const app = mount(() => {
      onError((error) => caught.push(error));
      const host = document.createElement('div');
      host.appendChild(
        when(show, () => {
          const childHost = document.createElement('span');
          mount(() => {
            const child = document.createElement('span');
            child.appendChild(
              when(
                () => true,
                () => {
                  watch(() => {
                    if (trigger()) throw failure;
                  });
                  return document.createTextNode('child');
                },
              ) as Node,
            );
            return child;
          }, childHost);
          return childHost;
        }) as Node,
      );
      return host;
    }, document.createElement('div'));
    stops.push(app.unmount);

    show(true);
    await tick();
    trigger(true);
    await tick();
    expect(caught).toEqual([failure]);
  });

  it('releases failed child work before handling the error and keeps queued siblings running', async () => {
    const trigger = state(0);
    const childSource = state(0);
    const failure = new Error('failed after creating children');
    const events: string[] = [];
    let childRuns = 0;
    const app = mount(() => {
      onError((error) => {
        expect(error).toBe(failure);
        events.push('handled');
      });
      watch(() => {
        if (trigger() === 0) return;
        watch(() => {
          childSource();
          childRuns++;
          return () => {
            events.push('child disposed');
          };
        });
        onDispose(() => {
          events.push('run disposed');
        });
        throw failure;
      });
      watch(() => {
        if (trigger() !== 0) events.push('sibling ran');
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    trigger(1);
    await tick();
    expect(events).toEqual(['child disposed', 'run disposed', 'handled', 'sibling ran']);
    expect(childRuns).toBe(1);
    childSource(1);
    await tick();
    expect(childRuns).toBe(1);
  });

  for (const destroyAt of ['before cleanup', 'during cleanup'] as const) {
    it(`does not call a released component boundary when destroyed ${destroyAt}`, async () => {
      const trigger = state(false);
      const failure = new Error('owner destroyed');
      const caught: unknown[] = [];
      const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
      const app = mount(() => {
        onError((error) => caught.push(error));
        watch(() => {
          if (!trigger()) return;
          if (destroyAt === 'before cleanup') app.unmount();
          else onDispose(() => app.unmount());
          throw failure;
        });
        return document.createTextNode('ready');
      }, document.createElement('div'));
      stops.push(app.unmount);

      trigger(true);
      await tick();
      expect(caught).toEqual([]);
      expect(reported).toHaveBeenCalledExactlyOnceWith('[Purity] watch/effect threw:', failure);
    });
  }

  it('recovers on later valid updates without subscribing to handler-only reads', async () => {
    const trigger = state(0);
    const handlerOnly = state(0);
    const caught: unknown[] = [];
    const values: number[] = [];
    const failure = new Error('invalid value');
    let runs = 0;
    const app = mount(() => {
      onError((error) => {
        handlerOnly();
        caught.push(error);
      });
      watch(() => {
        runs++;
        const value = trigger();
        if (value < 0) throw failure;
        values.push(value);
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    trigger(-1);
    await tick();
    expect(caught).toEqual([failure]);
    handlerOnly(1);
    await tick();
    expect(runs).toBe(2);
    trigger(2);
    await tick();
    expect(runs).toBe(3);
    expect(values).toEqual([0, 2]);
    expect(caught).toEqual([failure]);
  });

  it('keeps the existing behavior when an error handler throws', async () => {
    const trigger = state(false);
    const failure = new Error('watch failed');
    const handlerFailure = new Error('handler failed');
    const caught: unknown[] = [];
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = mount(() => {
      onError(() => {
        throw handlerFailure;
      });
      onError((error) => caught.push(error));
      watch(() => {
        if (trigger()) throw failure;
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    trigger(true);
    await tick();
    expect(caught).toEqual([failure]);
    expect(reported).toHaveBeenCalledExactlyOnceWith(
      '[Purity] Error in onError handler:',
      handlerFailure,
    );
  });

  it('stops dispatching released handlers when a handler unmounts its owner', async () => {
    const trigger = state(false);
    const failure = new Error('watch failed');
    const caught: unknown[] = [];
    let staleCalls = 0;
    const app = mount(() => {
      onError((error) => {
        caught.push(error);
        app.unmount();
      });
      onError(() => staleCalls++);
      watch(() => {
        if (trigger()) throw failure;
      });
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);

    trigger(true);
    await tick();
    expect(caught).toEqual([failure]);
    expect(staleCalls).toBe(0);
  });

  for (const owner of ['unowned', 'component without boundary'] as const) {
    it(`reports ${owner} failures and runs independent queued work`, async () => {
      const trigger = state(false);
      const failure = new Error('unhandled watch failed');
      const values: boolean[] = [];
      const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
      const start = () => {
        const stop = watch(() => {
          if (trigger()) throw failure;
        });
        if (owner === 'unowned') stops.push(stop);
        return document.createTextNode('ready');
      };
      if (owner === 'unowned') start();
      else stops.push(mount(start, document.createElement('div')).unmount);
      stops.push(
        watch(() => {
          values.push(trigger());
        }),
      );

      trigger(true);
      await tick();
      expect(reported).toHaveBeenCalledExactlyOnceWith('[Purity] watch/effect threw:', failure);
      expect(values).toEqual([false, true]);
    });
  }

  it('preserves synchronous first-run errors for callers to catch', () => {
    const failure = new Error('initial watch failed');
    const caught: unknown[] = [];
    const app = mount(() => {
      onError((error) => caught.push(error));
      expect(() =>
        watch(() => {
          throw failure;
        }),
      ).toThrow(failure);
      return document.createTextNode('ready');
    }, document.createElement('div'));
    stops.push(app.unmount);
    expect(caught).toEqual([]);
  });
});
