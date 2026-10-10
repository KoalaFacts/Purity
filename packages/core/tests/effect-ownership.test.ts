import { describe, expect, it } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { each, match, when } from '../src/control.ts';
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
