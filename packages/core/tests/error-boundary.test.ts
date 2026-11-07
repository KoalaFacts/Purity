import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { compute, state, watch } from '@purityjs/signals';
import { errorBoundary } from '../src/boundary.ts';
import { mount, onDispose, onError, onMount } from '../src/component.ts';
import { component, slot } from '../src/elements.ts';
import { onFormReset } from '../src/forms/lifecycle.ts';
import { getCurrentComponent } from '@purityjs/signals';
import { html } from '../src/compiler/compile.ts';
import { when } from '../src/control.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.restoreAllMocks();
});

function text(value: () => string): Text {
  const node = document.createTextNode('');
  watch(() => {
    node.data = value();
  });
  return node;
}

function el(tag: string, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag);
  for (let i = 0; i < children.length; i++) node.appendChild(children[i]);
  return node;
}

function render(app: () => Node): HTMLElement {
  const host = document.createElement('div');
  unmounts.push(mount(app, host).unmount);
  return host;
}

describe('errorBoundary()', () => {
  it('renders the view while nothing fails', () => {
    const host = render(() =>
      el(
        'main',
        errorBoundary(
          () => el('p', document.createTextNode('ok')),
          () => document.createTextNode('failed'),
        ),
      ),
    );
    expect(host.textContent).toBe('ok');
  });

  it('replaces only its subtree when a derived value later throws; siblings keep updating', async () => {
    const input = state(1);
    const sibling = state('a');
    const derived = compute(() => {
      if (input() < 0) throw new Error('negative');
      return String(input());
    });
    const outer: unknown[] = [];
    const host = render(() => {
      onError((error) => outer.push(error));
      return el(
        'main',
        el(
          'section',
          errorBoundary(
            () => el('p', text(derived)),
            (error) => el('em', document.createTextNode(`failed: ${(error as Error).message}`)),
          ),
        ),
        el('aside', text(sibling)),
      );
    });
    expect(host.querySelector('section')!.textContent).toBe('1');

    input(-1);
    await tick();
    expect(host.querySelector('section')!.innerHTML).toBe(
      '<!--eb--><em>failed: negative</em><!--/eb-->',
    );
    expect(outer).toEqual([]);

    sibling('b');
    await tick();
    expect(host.querySelector('aside')!.textContent).toBe('b');
  });

  it('catches a synchronous render throw', () => {
    const host = render(() =>
      errorBoundary(
        () => {
          throw new Error('render');
        },
        (error) => document.createTextNode((error as Error).message),
      ),
    );
    expect(host.textContent).toBe('render');
  });

  it('reset() re-renders the view and disposes the failed and fallback work once', async () => {
    const input = state(-1);
    let viewDisposals = 0;
    let fallbackDisposals = 0;
    let fallbackRuns = 0;
    let doReset: () => void = () => {};
    const host = render(() =>
      errorBoundary(
        () => {
          onDispose(() => viewDisposals++);
          return text(() => {
            if (input() < 0) throw new Error('bad input');
            return `value ${input()}`;
          });
        },
        (_error, reset) => {
          doReset = reset;
          onDispose(() => fallbackDisposals++);
          return text(() => {
            fallbackRuns++;
            return `retry (${input()})`;
          });
        },
      ),
    );
    expect(host.textContent).toBe('retry (-1)');
    expect(viewDisposals).toBe(1);

    input(5);
    await tick();
    expect(host.textContent).toBe('retry (5)');
    expect(fallbackRuns).toBe(2);

    doReset();
    expect(host.textContent).toBe('value 5');
    expect(fallbackDisposals).toBe(1);

    // The fallback's watch is gone: further writes do not re-run it.
    input(6);
    await tick();
    expect(fallbackRuns).toBe(2);
    expect(host.textContent).toBe('value 6');

    // Calling a stale reset() again is a no-op.
    doReset();
    expect(viewDisposals).toBe(1);
    expect(fallbackDisposals).toBe(1);
  });

  it('reset() that fails again shows the fallback with the new error', () => {
    let attempt = 0;
    const seen: string[] = [];
    let doReset: () => void = () => {};
    const host = render(() =>
      errorBoundary(
        () => {
          attempt++;
          if (attempt < 3) throw new Error(`attempt ${attempt}`);
          return document.createTextNode('recovered');
        },
        (error, reset) => {
          doReset = reset;
          seen.push((error as Error).message);
          return document.createTextNode('fallback');
        },
      ),
    );
    expect(host.textContent).toBe('fallback');
    doReset();
    expect(host.textContent).toBe('fallback');
    doReset();
    expect(host.textContent).toBe('recovered');
    expect(seen).toEqual(['attempt 1', 'attempt 2']);
  });

  it('a throwing fallback reaches the nearest outer boundary', () => {
    const host = render(() =>
      errorBoundary(
        () =>
          el(
            'div',
            errorBoundary(
              () => {
                throw new Error('inner view');
              },
              (error) => {
                throw new Error(`inner fallback after ${(error as Error).message}`);
              },
            ),
          ),
        (error) => document.createTextNode(`outer: ${(error as Error).message}`),
      ),
    );
    expect(host.textContent).toBe('outer: inner fallback after inner view');
  });

  it('a throwing fallback with no outer boundary reaches the component onError', async () => {
    const fail = state(false);
    const caught: unknown[] = [];
    const host = render(() => {
      onError((error) => caught.push((error as Error).message));
      return el(
        'div',
        errorBoundary(
          () =>
            text(() => {
              if (fail()) throw new Error('view');
              return 'ok';
            }),
          () => {
            throw new Error('fallback');
          },
        ),
      );
    });
    fail(true);
    await tick();
    expect(caught).toEqual(['fallback']);
    expect(host.querySelector('div')!.innerHTML).toBe('<!--eb--><!--/eb-->');
  });

  it('removes nodes added by nested control flow when the view fails', async () => {
    const show = state(false);
    const fail = state(false);
    const host = render(() =>
      el(
        'div',
        errorBoundary(
          () => {
            const frag = document.createDocumentFragment();
            frag.appendChild(when(show, () => document.createTextNode('shown')));
            frag.appendChild(
              text(() => {
                if (fail()) throw new Error('x');
                return '!';
              }),
            );
            return frag;
          },
          () => document.createTextNode('fallback'),
        ),
      ),
    );
    show(true);
    await tick();
    expect(host.textContent).toBe('shown!');
    fail(true);
    await tick();
    expect(host.textContent).toBe('fallback');
  });

  it('runs onMount registered in the view and in the fallback', async () => {
    const mounted: string[] = [];
    let doReset: () => void = () => {};
    let fail = true;
    render(() =>
      errorBoundary(
        () => {
          onMount(() => mounted.push('view'));
          if (fail) throw new Error('first');
          return document.createTextNode('view');
        },
        (_error, reset) => {
          doReset = reset;
          onMount(() => mounted.push('fallback'));
          return document.createTextNode('fallback');
        },
      ),
    );
    await tick();
    expect(mounted).toEqual(['fallback']);
    fail = false;
    doReset();
    await tick();
    expect(mounted).toEqual(['fallback', 'view']);
  });

  it('owner disposal tears down the view, removes its markers and ignores later resets', async () => {
    const input = state(0);
    let runs = 0;
    let doReset: () => void = () => {};
    const host = document.createElement('div');
    const app = mount(
      () =>
        el(
          'div',
          errorBoundary(
            () =>
              text(() => {
                runs++;
                if (input() === 1) throw new Error('one');
                return String(input());
              }),
            (_error, reset) => {
              doReset = reset;
              return document.createTextNode('fallback');
            },
          ),
        ),
      host,
    );
    input(1);
    await tick();
    expect(host.textContent).toBe('fallback');
    app.unmount();
    doReset();
    input(2);
    await tick();
    expect(runs).toBe(2);
    expect(host.innerHTML).toBe('');
  });

  it('does not catch event handler errors', () => {
    const errors: unknown[] = [];
    const listener = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', listener);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const host = render(() =>
        errorBoundary(
          () => {
            const button = el('button', document.createTextNode('view'));
            button.addEventListener('click', () => {
              throw new Error('click');
            });
            return button;
          },
          () => document.createTextNode('fallback'),
        ),
      );
      host.querySelector('button')!.click();
      expect(host.textContent).toBe('view');
      expect(errors.map((e) => (e as Error).message)).toEqual(['click']);
    } finally {
      window.removeEventListener('error', listener);
    }
  });

  it('runs the README template example: retry button resets after the input recovers', async () => {
    const total = state<number | null>(1.5);
    const host = render(
      () =>
        html`<section>
          ${errorBoundary(
            () => html`<p>${() => total()!.toFixed(2)}</p>`,
            (error, reset) =>
              html`<p role="alert">${String(error)}</p>
                <button @click=${reset}>Retry</button>`,
          )}
        </section>` as unknown as Node,
    );
    expect(host.querySelector('p')!.textContent).toBe('1.50');
    total(null);
    await tick();
    expect(host.querySelector('[role=alert]')!.textContent).toContain('TypeError');
    host.querySelector('button')!.click();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    total(2);
    host.querySelector('button')!.click();
    expect(host.querySelector('section')!.textContent!.trim()).toBe('2.00');
  });

  it('releases work the view creates after a nested failure already showed the fallback', async () => {
    const input = state(0);
    let lateRuns = 0;
    let lateChildDisposals = 0;
    const host = render(() =>
      errorBoundary(
        () => {
          mount(() => {
            throw new Error('nested');
          }, document.createElement('div'));
          watch(() => {
            input();
            lateRuns++;
          });
          mount(() => {
            onDispose(() => lateChildDisposals++);
            return document.createTextNode('late child');
          }, document.createElement('div'));
          return document.createTextNode('view');
        },
        (error) => document.createTextNode(`fallback: ${(error as Error).message}`),
      ),
    );
    expect(host.textContent).toBe('fallback: nested');
    expect(lateRuns).toBe(1);
    input(1);
    await tick();
    expect(lateRuns).toBe(1);
    expect(lateChildDisposals).toBe(1);
  });

  it('keeps the first fallback when the view throws after a nested failure', () => {
    const seen: string[] = [];
    const host = render(() =>
      errorBoundary(
        () => {
          mount(() => {
            throw new Error('nested');
          }, document.createElement('div'));
          throw new Error('consequence');
        },
        (error) => {
          seen.push((error as Error).message);
          return document.createTextNode('fallback');
        },
      ),
    );
    expect(host.textContent).toBe('fallback');
    expect(seen).toEqual(['nested']);
  });

  it('slot() inside the view reads the host component slot content', () => {
    const render = component('p-eb-slot-host', () =>
      el(
        'div',
        errorBoundary(
          () => {
            const content = slot()();
            return el('b', (content as Node) ?? document.createTextNode('empty'));
          },
          () => document.createTextNode('failed'),
        ),
      ),
    );
    const root = render({}, { default: () => document.createTextNode('slotted') }) as Element;
    expect(root.textContent).toBe('slotted');
  });

  it('a failed view does not clear the host slot content (inside after reset, and outside)', async () => {
    const fail = state(false);
    let doReset: (() => void) | null = null;
    const render = component('p-eb-slot-reset-host', () =>
      el(
        'div',
        errorBoundary(
          () => {
            const content = slot()();
            return el(
              'b',
              text(() => {
                if (fail()) throw new Error('later');
                return 'ok:';
              }),
              (content as Node) ?? document.createTextNode('EMPTY'),
            );
          },
          (_error, reset) => {
            doReset = reset;
            return document.createTextNode('fallback');
          },
        ),
        when(
          () => fail(),
          () => el('i', (slot()() as Node) ?? document.createTextNode('GONE')),
        ),
      ),
    );
    let n = 0;
    const root = render({}, { default: () => document.createTextNode(`slotted${++n}`) }) as Element;
    expect(root.textContent).toBe('ok:slotted1');
    fail(true);
    await tick();
    expect(root.textContent).toBe('fallbackslotted2');
    fail(false);
    await tick();
    doReset!();
    await tick();
    expect(root.textContent).toBe('ok:slotted3');
  });

  it('a form hook registered inside the view reaches the host and is released with it', async () => {
    const fail = state(false);
    let doReset: (() => void) | null = null;
    let host: ReturnType<typeof getCurrentComponent> = null;
    const render = component('p-eb-form-hook-host', () => {
      host = getCurrentComponent();
      return el(
        'div',
        errorBoundary(
          () => {
            onFormReset(() => {});
            return text(() => {
              if (fail()) throw new Error('later');
              return 'view';
            });
          },
          (_error, reset) => {
            doReset = reset;
            return document.createTextNode('failed');
          },
        ),
      );
    });
    render({});
    expect(host!._formReset?.length).toBe(1);
    // A failed view releases its hook; a reset registers exactly one again.
    fail(true);
    await tick();
    expect(host!._formReset?.length).toBe(0);
    fail(false);
    doReset!();
    await tick();
    expect(host!._formReset?.length).toBe(1);
  });

  it('form hooks registered by a nested scope inside the view are released on failure and when the scope closes', async () => {
    const fail = state(false);
    const open = state(false);
    let doReset: (() => void) | null = null;
    let host: ReturnType<typeof getCurrentComponent> = null;
    const render = component('p-eb-nested-form-hook-host', () => {
      host = getCurrentComponent();
      return el(
        'div',
        errorBoundary(
          () =>
            el(
              'span',
              when(open, () => {
                onFormReset(() => {});
                return document.createTextNode('open');
              }) as unknown as Node,
              text(() => {
                if (fail()) throw new Error('later');
                return 'view';
              }),
            ),
          (_error, reset) => {
            doReset = reset;
            return document.createTextNode('failed');
          },
        ),
      );
    });
    render({});
    expect(host!._formReset?.length ?? 0).toBe(0);
    // A branch opening after the first render registers on the host.
    open(true);
    await tick();
    expect(host!._formReset?.length).toBe(1);
    // Closing the branch while the view is alive releases it.
    open(false);
    await tick();
    expect(host!._formReset?.length).toBe(0);
    open(true);
    await tick();
    expect(host!._formReset?.length).toBe(1);
    // The view failing releases the nested registration.
    fail(true);
    await tick();
    expect(host!._formReset?.length).toBe(0);
    // Reset re-renders with the branch open: exactly one again, not two.
    fail(false);
    doReset!();
    await tick();
    expect(host!._formReset?.length).toBe(1);
  });

  it('a reset() called while the fallback renders shows only the view', () => {
    let fail = true;
    let lateFallbackRuns = 0;
    const input = state(0);
    const host = render(() =>
      el(
        'div',
        errorBoundary(
          () => {
            if (fail) throw new Error('first');
            return document.createTextNode('VIEW');
          },
          (_error, reset) => {
            fail = false;
            reset();
            watch(() => {
              input();
              lateFallbackRuns++;
            });
            return document.createTextNode('FALLBACK');
          },
        ),
      ),
    );
    expect(host.querySelector('div')!.innerHTML).toBe('<!--eb-->VIEW<!--/eb-->');
    input(1);
    return tick().then(() => expect(lateFallbackRuns).toBe(1));
  });

  it('a nested failure in an inner fallback reaches the outer boundary without extra errors', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = render(() =>
      errorBoundary(
        () =>
          el(
            'div',
            errorBoundary(
              () => {
                throw new Error('inner view');
              },
              () => {
                mount(() => {
                  throw new Error('child in fallback');
                }, document.createElement('div'));
                return document.createTextNode('inner fallback');
              },
            ),
          ),
        (error) => document.createTextNode(`OUTER: ${(error as Error).message}`),
      ),
    );
    expect(host.textContent).toBe('OUTER: child in fallback');
    expect(reported).not.toHaveBeenCalled();
  });

  it('disposing the enclosing branch removes the markers while the component stays mounted', async () => {
    const show = state(true);
    const fail = state(false);
    let runs = 0;
    const host = render(() =>
      el(
        'div',
        when(show, () =>
          errorBoundary(
            () =>
              text(() => {
                runs++;
                if (fail()) throw new Error('x');
                return 'view';
              }),
            () => document.createTextNode('fallback'),
          ),
        ),
      ),
    );
    expect(host.querySelector('div')!.innerHTML).toContain('<!--eb-->view<!--/eb-->');
    show(false);
    await tick();
    expect(host.querySelector('div')!.innerHTML).not.toContain('eb');
    fail(true);
    await tick();
    expect(runs).toBe(1);
  });

  it('works without a surrounding component', () => {
    const fragment = errorBoundary(
      () => {
        throw new Error('no owner');
      },
      (error) => document.createTextNode((error as Error).message),
    );
    const host = document.createElement('div');
    host.appendChild(fragment);
    expect(host.textContent).toBe('no owner');
  });
});
