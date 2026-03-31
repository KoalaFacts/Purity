import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { each, match, when } from '../src/control.ts';
import { batch, compute, state, watch } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

// ---------------------------------------------------------------------------
// Benchmark helpers
// ---------------------------------------------------------------------------

function bench(name: string, fn: () => void, iterations = 1): number {
  // Warmup
  fn();
  // Measure
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const perOp = iterations > 1 ? `(${(elapsed / iterations).toFixed(3)}ms/op)` : '';
  console.log(`  ${name}: ${elapsed.toFixed(2)}ms ${perOp}`);
  return elapsed;
}

async function benchAsync(name: string, fn: () => Promise<void>): Promise<number> {
  await fn(); // warmup
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  console.log(`  ${name}: ${elapsed.toFixed(2)}ms`);
  return elapsed;
}

// ---------------------------------------------------------------------------
// Signal benchmarks — comparable to SolidJS createSignal/createEffect
// ---------------------------------------------------------------------------

describe('benchmark: signals (vs Solid/Preact)', () => {
  it('create 10k signals', () => {
    bench('create 10k signals', () => {
      for (let i = 0; i < 10_000; i++) state(i);
    });
  });

  it('create 10k computed', () => {
    const s = state(0);
    bench('create 10k computed', () => {
      for (let i = 0; i < 10_000; i++) compute(() => s() + i);
    });
  });

  it('read signal 1M times', () => {
    const s = state(42);
    let sum = 0;
    bench('1M signal reads', () => {
      sum = 0;
      for (let i = 0; i < 1_000_000; i++) sum += s();
    });
    expect(sum).toBe(42_000_000);
  });

  it('write signal 1M times', () => {
    const s = state(0);
    bench('1M signal writes', () => {
      for (let i = 0; i < 1_000_000; i++) s(i);
    });
  });

  it('deep computed chain (1000 levels)', () => {
    const source = state(0);
    let tip: any = source;
    for (let i = 0; i < 1000; i++) {
      const prev = tip;
      tip = compute(() => prev() + 1);
    }
    bench(
      '1000-deep computed propagation',
      () => {
        source(source() + 1);
        tip();
      },
      100,
    );
  });

  it('wide fan-out (1 signal → 1000 computed)', () => {
    const source = state(0);
    const deps: any[] = [];
    for (let i = 0; i < 1000; i++) deps.push(compute(() => source() + i));
    bench(
      '1→1000 fan-out read',
      () => {
        source(source() + 1);
        for (let i = 0; i < 1000; i++) deps[i]();
      },
      100,
    );
  });

  it('diamond dependency (no glitch)', () => {
    const a = state(1);
    const b = compute(() => a() * 2);
    const c = compute(() => a() * 3);
    let evals = 0;
    const d = compute(() => {
      evals++;
      return b() + c();
    });
    d(); // initial

    evals = 0;
    a(2);
    d();
    // Single update should evaluate d exactly once
    expect(evals).toBe(1);

    bench('diamond (1000 updates)', () => {
      for (let i = 0; i < 1000; i++) {
        a(i);
        d();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Effect/watch benchmarks — comparable to createEffect
// ---------------------------------------------------------------------------

describe('benchmark: effects (vs Solid/Preact)', () => {
  it('create + dispose 1000 effects', async () => {
    const s = state(0);
    await benchAsync('create+dispose 1k effects', async () => {
      const disposers: any[] = [];
      for (let i = 0; i < 1000; i++) {
        disposers.push(
          watch(() => {
            s();
          }),
        );
      }
      for (const d of disposers) d();
    });
  });

  it('1 source → 100 watchers react', async () => {
    const s = state(0);
    let runs = 0;
    for (let i = 0; i < 100; i++)
      watch(() => {
        s();
        runs++;
      });
    runs = 0;

    await benchAsync('100 watchers react', async () => {
      runs = 0;
      s(s() + 1);
      await tick();
    });
    expect(runs).toBe(100);
  });

  it('batch 1000 writes → single effect', async () => {
    const signals: any[] = [];
    for (let i = 0; i < 100; i++) signals.push(state(0));
    let runs = 0;
    watch(() => {
      for (const s of signals) s();
      runs++;
    });
    runs = 0;

    await benchAsync('batch 1000 writes', async () => {
      runs = 0;
      batch(() => {
        for (let i = 0; i < 1000; i++) signals[i % 100](i);
      });
      await tick();
    });
    expect(runs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Template benchmarks — comparable to Lit html / Solid JSX
// ---------------------------------------------------------------------------

describe('benchmark: templates (vs Lit/Solid)', () => {
  it('render 1000 simple elements', () => {
    bench('1k html`<div>text</div>`', () => {
      for (let i = 0; i < 1000; i++) html`<div>Hello ${i}</div>`;
    });
  });

  it('render 100 elements with reactive binding', () => {
    const count = state(0);
    bench('100 reactive templates', () => {
      for (let i = 0; i < 100; i++) {
        html`<div class=${() => (count() > 5 ? 'active' : '')}><p>${() => count()}</p></div>`;
      }
    });
  });

  it('render 100 elements with event + attrs', () => {
    const fn = () => {};
    bench('100 templates with @click + ?disabled', () => {
      for (let i = 0; i < 100; i++) {
        html`<button @click=${fn} ?disabled=${() => false}>Click ${i}</button>`;
      }
    });
  });

  it('render deep nesting (10 levels)', () => {
    bench(
      '10-level nested templates',
      () => {
        let node: any = html`<span>leaf</span>`;
        for (let i = 0; i < 10; i++) {
          node = html`<div>${node}</div>`;
        }
      },
      100,
    );
  });
});

// ---------------------------------------------------------------------------
// Control flow benchmarks — comparable to Solid For/Show
// ---------------------------------------------------------------------------

describe('benchmark: control flow (vs Solid For/Show)', () => {
  it('each() render 1000 items', () => {
    const items = state(Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `Item ${i}` })));
    bench('each() 1000 items', () => {
      each(
        () => items(),
        (item) => html`<li>${item.text}</li>`,
        (item) => item.id,
      );
    });
  });

  it('match() switch 10 times', async () => {
    const status = state<string>('loading');
    const container = document.createElement('div');
    container.appendChild(
      match(() => status(), {
        loading: () => html`<p>Loading</p>`,
        error: () => html`<p>Error</p>`,
        success: () => html`<p>Done</p>`,
      }),
    );

    await benchAsync('match() 10 switches', async () => {
      const states = ['loading', 'error', 'success'];
      for (let i = 0; i < 10; i++) {
        status(states[i % 3]);
        await tick();
      }
    });
  });

  it('when() toggle 10 times', async () => {
    const visible = state(true);
    const container = document.createElement('div');
    container.appendChild(
      when(
        () => visible(),
        () => html`<p>Visible</p>`,
        () => html`<p>Hidden</p>`,
      ),
    );

    await benchAsync('when() 10 toggles', async () => {
      for (let i = 0; i < 10; i++) {
        visible(!visible.peek());
        await tick();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Reactive update benchmark — the real-world scenario
// ---------------------------------------------------------------------------

describe('benchmark: reactive DOM updates', () => {
  it('update 10 text nodes from 1 signal', async () => {
    const count = state(0);
    const container = document.createElement('div');
    for (let i = 0; i < 10; i++) {
      container.appendChild(html`<span>${() => count()}</span>`);
    }

    await benchAsync('10 text nodes react x 10 updates', async () => {
      for (let i = 0; i < 10; i++) {
        count(i);
        await tick();
      }
    });
  });

  it('update 5 attributes from 5 signals', async () => {
    const signals = Array.from({ length: 5 }, (_, i) => state(`class-${i}`));
    const container = document.createElement('div');
    for (let i = 0; i < 5; i++) {
      const s = signals[i];
      container.appendChild(html`<div class=${() => s()}>Item</div>`);
    }

    await benchAsync('5 attr updates x 10 cycles', async () => {
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < 5; i++) {
          signals[i](`updated-${cycle}-${i}`);
        }
        await tick();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

describe('benchmark: reference numbers', () => {
  it('prints comparison context', () => {
    console.log(`
  ┌───────────────────────────────────────────────────┐
  │ Reference: SolidJS / Lit / Preact Signals          │
  │                                                     │
  │ Signal create:     ~0.005ms each (Solid)            │
  │ Signal read:       ~0.00003ms each (Solid)          │
  │ Signal write:      ~0.00005ms each (Solid)          │
  │ Effect create:     ~0.01ms each (Solid)             │
  │ Template render:   ~0.05ms each (Lit html)          │
  │ List render 1000:  ~5-15ms (Solid For)              │
  │                                                     │
  │ Purity uses signal-polyfill (JS, not native C++)    │
  │ Native signals will be faster when browsers ship    │
  └───────────────────────────────────────────────────┘
    `);
    expect(true).toBe(true);
  });
});
