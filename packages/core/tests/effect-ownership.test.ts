import { describe, expect, it } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import {
  bindComponentState,
  ComponentContext,
  mount,
  onDestroy,
  onDispose,
  onError,
  onMount,
  popContext,
  pushContext,
} from '../src/component.ts';
import { each, match, when } from '../src/control.ts';
import { component, slot } from '../src/elements.ts';
import { css } from '../src/styles.ts';
import { state, watch } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

// Reactive work created while an effect runs belongs to that effect: it is
// disposed before the effect re-runs and when the effect is disposed. Without
// this, every re-run leaked another live binding or watcher.
describe('effect-owned reactive work', () => {
  it('a conditional template inside a reactive binding does not accumulate live bindings', async () => {
    const show = state(true);
    const x = state(0);
    let runs = 0;
    const host = document.createElement('div');
    mount(
      () =>
        html`<div>${() =>
          show()
            ? html`<p>${() => {
                runs++;
                return x();
              }}</p>`
            : null}</div>`,
      host,
    );
    for (let i = 0; i < 20; i++) {
      show(!show());
      await tick();
    }
    show(true);
    await tick();
    runs = 0;
    x(1);
    await tick();
    expect(runs).toBe(1);
    expect(host.textContent).toBe('1');
  });

  it('a watch created inside a watch is disposed when the outer one re-runs', async () => {
    const outer = state(0);
    const x = state(0);
    let runs = 0;
    const stop = watch(() => {
      outer();
      watch(() => {
        runs++;
        x();
      });
    });
    for (let i = 1; i <= 20; i++) {
      outer(i);
      await tick();
    }
    runs = 0;
    x(1);
    await tick();
    expect(runs).toBe(1);

    stop();
    runs = 0;
    x(2);
    await tick();
    expect(runs).toBe(0);
  });

  it('runs a disposed inner effect cleanup without tracking its reads into the outer effect', async () => {
    const a = state(0);
    const y = state(0);
    let outerRuns = 0;
    let inner: (() => void) | null = null;
    const stop = watch(() => {
      outerRuns++;
      a();
      if (inner) inner();
      inner = watch(() => () => {
        y();
      });
    });
    a(1);
    await tick();
    outerRuns = 0;
    y(1);
    await tick();
    expect(outerRuns).toBe(0);
    stop();
  });

  it('releases work an effect created before its re-run threw', async () => {
    const trigger = state(0);
    const x = state(0);
    let innerRuns = 0;
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const stop = watch(() => {
        if (trigger() === 0) return;
        watch(() => {
          innerRuns++;
          x();
        });
        throw new Error('boom');
      });
      trigger(1);
      await tick();
      expect(errors.length).toBe(1);
      innerRuns = 0;
      x(1);
      await tick();
      expect(innerRuns).toBe(0);
      stop();
    } finally {
      console.error = original;
    }
  });

  it('keeps an outer-created template live when a binding re-runs and returns it again', async () => {
    const show = state(true);
    const unrelated = state(0);
    const x = state('a');
    const host = document.createElement('div');
    mount(() => {
      const kept = html`<b>${() => x()}</b>`;
      return html`<div>${() => {
        unrelated();
        return show() ? kept : null;
      }}</div>`;
    }, host);
    unrelated(1);
    await tick();
    x('b');
    await tick();
    expect(host.textContent).toBe('b');
  });
});

describe('when()/match() branch lifecycle', () => {
  it('stops a hidden branch and renders a live branch again when shown', async () => {
    const show = state(true);
    const x = state(0);
    let runs = 0;
    const host = document.createElement('div');
    mount(
      () =>
        html`<div>${when(
          () => show(),
          () =>
            html`<p>${() => {
              runs++;
              return x();
            }}</p>`,
        )}</div>`,
      host,
    );
    show(false);
    await tick();
    runs = 0;
    x(1);
    await tick();
    expect(runs).toBe(0);

    show(true);
    await tick();
    expect(host.textContent).toBe('1');
    runs = 0;
    x(2);
    await tick();
    expect(runs).toBe(1);
    expect(host.textContent).toBe('2');
  });

  it('keeps the active match() branch live when the selector re-runs on the same case', async () => {
    const mode = state<'a' | 'b'>('a');
    const noise = state(0);
    const x = state(0);
    const host = document.createElement('div');
    mount(
      () =>
        html`<div>${match(
          () => {
            noise();
            return mode();
          },
          {
            a: () => html`<p>${() => x()}</p>`,
            b: () => html`<i>b</i>`,
          },
        )}</div>`,
      host,
    );
    noise(1);
    await tick();
    x(5);
    await tick();
    expect(host.textContent).toBe('5');
  });
});

describe('lean scopes keep their component', () => {
  it('lets a case shown again in a later flush reach its component', async () => {
    const show = state(true);
    const errors: unknown[] = [];
    const Host = component(
      `p-reshow-host-${Date.now()}`,
      () =>
        html`<div>${when(
          () => show(),
          () => {
            try {
              slot();
            } catch (e) {
              errors.push(e);
            }
            return html`<i>b</i>`;
          },
        )}</div>`,
    );
    mount(() => Host({}), document.createElement('div'));
    show(false);
    await tick();
    show(true);
    await tick();
    expect(errors).toEqual([]);
  });

  it('routes a branch child component error to the enclosing onError', async () => {
    const caught: unknown[] = [];
    const boom = new Error('boom');
    const Child = component(`p-err-child-${Date.now()}`, () => {
      onMount(() => {
        throw boom;
      });
      return html`<span>c</span>`;
    });
    const Host = component(`p-err-host-${Date.now()}`, () => {
      onError((e) => caught.push(e));
      return html`<div>${when(
        () => true,
        () => Child({}),
      )}</div>`;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(() => Host({}), host);
    await tick();
    await tick();
    expect(caught).toContain(boom);
    host.remove();
  });

  it('unmounts a root mounted from an effect when the host unmounts', () => {
    let destroyed = 0;
    const { unmount } = mount(() => {
      watch(() => {
        mount(() => {
          onDestroy(() => destroyed++);
          return html`<i>nested</i>`;
        }, document.createElement('div'));
      });
      return html`<p>host</p>`;
    }, document.createElement('div'));
    unmount();
    expect(destroyed).toBe(1);
  });

  it('releases a branch custom-state contribution when the branch is hidden', async () => {
    const states = new Set<string>();
    const host = new ComponentContext();
    host._internals = {
      states: { add: (s: string) => states.add(s), delete: (s: string) => states.delete(s) },
    } as unknown as ElementInternals;
    const show = state(true);
    pushContext(host);
    try {
      document.createElement('div').appendChild(
        when(
          () => show(),
          () => {
            bindComponentState('busy', () => true);
            return html`<i>busy</i>`;
          },
        ) as Node,
      );
    } finally {
      popContext();
    }
    expect(states.has('busy')).toBe(true);
    show(false);
    await tick();
    expect(states.has('busy')).toBe(false);
  });
});

describe('late branches and failed renders', () => {
  it('releases work a case created before its renderer threw', async () => {
    const mode = state<'a' | 'b'>('a');
    const x = state(0);
    let runs = 0;
    const original = console.error;
    console.error = () => {};
    try {
      mount(
        () =>
          html`<div>${match(() => mode(), {
            a: () => html`<i>a</i>`,
            b: () => {
              watch(() => {
                runs++;
                x();
              });
              throw new Error('boom');
            },
          })}</div>`,
        document.createElement('div'),
      );
      mode('b');
      await tick();
      runs = 0;
      x(1);
      await tick();
      expect(runs).toBe(0);
    } finally {
      console.error = original;
    }
  });

  it('runs onMount from a branch first shown after the component mounted', async () => {
    const show = state(false);
    let mounted = 0;
    mount(
      () =>
        html`<div>${when(
          () => show(),
          () => {
            onMount(() => mounted++);
            return html`<i>late</i>`;
          },
        )}</div>`,
      document.createElement('div'),
    );
    await tick();
    show(true);
    await tick();
    await tick();
    expect(mounted).toBe(1);
  });

  it('does not track reads made by an outgoing case cleanup into the selector', async () => {
    const mode = state<'a' | 'b'>('a');
    const unrelated = state(0);
    let selectorRuns = 0;
    mount(
      () =>
        html`<div>${match(
          () => {
            selectorRuns++;
            return mode();
          },
          {
            a: () => {
              onDispose(() => unrelated());
              return html`<i>a</i>`;
            },
            b: () => html`<i>b</i>`,
          },
        )}</div>`,
      document.createElement('div'),
    );
    mode('b');
    await tick();
    selectorRuns = 0;
    unrelated(1);
    await tick();
    expect(selectorRuns).toBe(0);
  });

  it('lets errors bubble once a branch-scoped onError is removed', async () => {
    const show = state(true);
    const host = new ComponentContext();
    pushContext(host);
    try {
      document.createElement('div').appendChild(
        when(
          () => show(),
          () => {
            onError(() => {});
            return html`<i>b</i>`;
          },
        ) as Node,
      );
    } finally {
      popContext();
    }
    show(false);
    await tick();
    expect(() => host._handleError(new Error('late'))).toThrow('late');
  });

  it('skips a late onMount when its component unmounted first', async () => {
    let ran = 0;
    let stop = (): void => {};
    stop = mount(() => {
      onMount(() => {
        onMount(() => ran++);
        stop();
      });
      return html`<p>x</p>`;
    }, document.createElement('div')).unmount;
    await tick();
    await tick();
    await tick();
    expect(ran).toBe(0);
  });

  it('skips a late onMount whose branch was hidden in the same flush', async () => {
    const show = state(false);
    const hidden = state(false);
    let mounted = 0;
    mount(
      () =>
        html`<div>${when(
          () => show() && !hidden(),
          () => {
            onMount(() => mounted++);
            return html`<i>late</i>`;
          },
        )}</div>`,
      document.createElement('div'),
    );
    watch(() => {
      if (show()) hidden(true);
    });
    await tick();
    show(true);
    await tick();
    await tick();
    expect(mounted).toBe(0);
  });

  it('runs onDestroy only for the branch instance still shown at unmount', async () => {
    const show = state(true);
    let destroyed = 0;
    const { unmount } = mount(
      () =>
        html`<div>${when(
          () => show(),
          () => {
            onDestroy(() => destroyed++);
            return html`<i>b</i>`;
          },
        )}</div>`,
      document.createElement('div'),
    );
    for (let i = 0; i < 3; i++) {
      show(false);
      await tick();
      show(true);
      await tick();
    }
    unmount();
    expect(destroyed).toBe(1);
  });

  it('removes a branch light-DOM style when the branch is hidden', async () => {
    const show = state(true);
    let scopeClass = '';
    const hasStyle = () =>
      Array.from(document.head.querySelectorAll('style')).some((el) =>
        el.textContent?.includes(scopeClass),
      );
    mount(
      () =>
        html`<div>${when(
          () => show(),
          () => {
            scopeClass = css`p { color: red; }`;
            return html`<p>x</p>`;
          },
        )}</div>`,
      document.createElement('div'),
    );
    expect(hasStyle()).toBe(true);
    show(false);
    await tick();
    expect(hasStyle()).toBe(false);
  });

  it('removes a branch shadow stylesheet when the branch is hidden', async () => {
    const g = globalThis as { CSSStyleSheet?: unknown };
    const hadSheet = 'CSSStyleSheet' in g;
    const prev = g.CSSStyleSheet;
    g.CSSStyleSheet = class {
      replaceSync(): void {}
    };
    try {
      const host = new ComponentContext();
      const shadow = { adoptedStyleSheets: [] as unknown[], ownerDocument: null };
      (host as unknown as { _shadowRoot: unknown })._shadowRoot = shadow;
      const show = state(true);
      pushContext(host);
      try {
        document.createElement('div').appendChild(
          when(
            () => show(),
            () => {
              css`p { color: red; }`;
              return html`<p>x</p>`;
            },
          ) as Node,
        );
      } finally {
        popContext();
      }
      expect(shadow.adoptedStyleSheets.length).toBe(1);
      show(false);
      await tick();
      expect(shadow.adoptedStyleSheets.length).toBe(0);
    } finally {
      if (hadSheet) g.CSSStyleSheet = prev;
      else delete g.CSSStyleSheet;
    }
  });
});

describe('when()/match() branch disposal edge cases', () => {
  it('unmounts a component() factory instance when its branch is hidden', async () => {
    const show = state(true);
    let destroyed = 0;
    const Child = component(`p-owned-child-${Date.now()}`, () => {
      onDestroy(() => destroyed++);
      return html`<span>child</span>`;
    });
    mount(
      () =>
        html`<div>${when(
          () => show(),
          () => Child({}),
        )}</div>`,
      document.createElement('div'),
    );
    for (let i = 0; i < 3; i++) {
      show(false);
      await tick();
      show(true);
      await tick();
    }
    expect(destroyed).toBe(3);
  });

  it('keeps the enclosing component visible to component-only APIs inside a branch', () => {
    let slotError: unknown = null;
    const Host = component(
      `p-branch-host-${Date.now()}`,
      () =>
        html`<div>${when(
          () => true,
          () => {
            try {
              slot();
            } catch (e) {
              slotError = e;
            }
            return html`<i>in branch</i>`;
          },
        )}</div>`,
    );
    mount(() => Host({}), document.createElement('div'));
    expect(slotError).toBeNull();
  });

  it('renders the case the selector holds after an outgoing case wrote it during disposal', async () => {
    const mode = state<'a' | 'b' | 'c'>('a');
    const host = document.createElement('div');
    mount(
      () =>
        html`<div>${match(() => mode(), {
          a: () => {
            onDispose(() => mode('c'));
            return html`<p>a</p>`;
          },
          b: () => html`<p>b</p>`,
          c: () => html`<p>c</p>`,
        })}</div>`,
      host,
    );
    mode('b');
    await tick();
    await tick();
    expect(host.textContent).toBe('c');
  });
});

describe('each() rows are unaffected', () => {
  it('reuses kept row nodes and keeps their bindings live across reconciles', async () => {
    const items = state([1, 2, 3]);
    const x = state(0);
    let runs = 0;
    const host = document.createElement('div');
    mount(
      () =>
        html`<ul>${each(
          () => items(),
          (item: () => number) =>
            html`<li>${() => {
              runs++;
              return x() + item();
            }}</li>`,
          (v: number) => v,
        )}</ul>`,
      host,
    );
    const firstRow = host.querySelector('li');
    items([1, 2, 3, 4]);
    await tick();
    expect(host.querySelector('li')).toBe(firstRow);
    runs = 0;
    x(10);
    await tick();
    expect(runs).toBe(4);
    expect(host.textContent).toBe('11121314');
  });
});
