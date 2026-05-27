// Tests for `internals()` accessor, `bindComponentState`, and the
// resource() auto-wire that exposes loading/error as `:state(...)` on the
// host element. jsdom ships `attachInternals` but the returned object has
// no `.states` — we polyfill it once per file with a plain `Set` (the spec
// defines CustomStateSet as Set-like so the shape matches).

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bindComponentState, mount, onDispose } from '../src/component.ts';
import { component, internals } from '../src/elements.ts';
import { html } from '../src/compiler/compile.ts';
import { resource } from '../src/resource.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

beforeAll(() => {
  // Polyfill: every ElementInternals returned by jsdom's stub gets a fresh
  // Set as its `states` slot. Real browsers ship a CustomStateSet, but
  // for our purposes (add/delete/has) a Set is structurally identical.
  const orig = HTMLElement.prototype.attachInternals;
  HTMLElement.prototype.attachInternals = function () {
    const i = orig.call(this) as ElementInternals;
    if (!('states' in i) || !(i as unknown as { states?: unknown }).states) {
      Object.defineProperty(i, 'states', { value: new Set<string>() });
    }
    return i;
  };
});

let tagSeq = 0;
const nextTag = () => `p-internals-${tagSeq++}`;

afterEach(() => {
  // No teardown needed — each test mounts into its own container.
});

describe('internals()', () => {
  it('returns the host element ElementInternals inside a component', () => {
    const tag = nextTag();
    let seen: ElementInternals | null = null;
    component(tag, () => {
      seen = internals();
      return html`<div></div>`;
    });

    const container = document.createElement('div');
    container.innerHTML = `<${tag}></${tag}>`;
    document.body.appendChild(container);
    expect(seen).not.toBeNull();
    expect(seen!.states).toBeDefined();
  });

  it('returns null outside a component (plain mount)', () => {
    let seen: ElementInternals | null | undefined;
    mount(() => {
      seen = internals();
      return document.createElement('div');
    }, document.createElement('div'));
    expect(seen).toBeNull();
  });
});

describe('bindComponentState', () => {
  it('adds the state when the accessor is truthy, removes when falsy', async () => {
    const tag = nextTag();
    const on = state(false);
    let observed: Set<string> | null = null;
    component(tag, () => {
      bindComponentState('open', on);
      observed = (internals()!.states as unknown as Set<string>) ?? null;
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    expect(observed!.has('open')).toBe(false);

    on(true);
    await tick();
    expect(observed!.has('open')).toBe(true);

    on(false);
    await tick();
    expect(observed!.has('open')).toBe(false);
  });

  it('composes multiple binders via ref-counting (state stays on while any are on)', async () => {
    const tag = nextTag();
    const a = state(false);
    const b = state(false);
    let observed: Set<string> | null = null;
    component(tag, () => {
      bindComponentState('busy', a);
      bindComponentState('busy', b);
      observed = (internals()!.states as unknown as Set<string>) ?? null;
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    expect(observed!.has('busy')).toBe(false);

    a(true);
    await tick();
    expect(observed!.has('busy')).toBe(true);

    b(true);
    await tick();
    expect(observed!.has('busy')).toBe(true); // still on — ref count is 2

    a(false);
    await tick();
    expect(observed!.has('busy')).toBe(true); // still on — b is still true

    b(false);
    await tick();
    expect(observed!.has('busy')).toBe(false); // both off
  });

  it('is a no-op outside a component', () => {
    expect(() => bindComponentState('whatever', () => true)).not.toThrow();
  });

  it('releases the ref on dispose so unmount cleans the state', async () => {
    const tag = nextTag();
    const on = state(true);
    let elInternals: ElementInternals | null = null;
    component(tag, () => {
      bindComponentState('alive', on);
      elInternals = internals();
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    await tick();
    const states = elInternals!.states as unknown as Set<string>;
    expect(states.has('alive')).toBe(true);

    // Remove the host — disconnectedCallback runs disposers.
    document.body.innerHTML = '';
    await tick();
    expect(states.has('alive')).toBe(false);
  });
});

describe('resource() auto-wires :state(loading) / :state(error)', () => {
  it('toggles :state(loading) for the resource lifecycle', async () => {
    const tag = nextTag();
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => {
      resolve = r;
    });
    let elInternals: ElementInternals | null = null;
    component(tag, () => {
      resource(() => p);
      elInternals = internals();
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    await tick();
    const states = elInternals!.states as unknown as Set<string>;
    expect(states.has('loading')).toBe(true);

    resolve('ok');
    await tick();
    await tick();
    expect(states.has('loading')).toBe(false);
  });

  it('toggles :state(error) when the fetcher rejects', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tag = nextTag();
    let reject!: (e: unknown) => void;
    const p = new Promise<string>((_, r) => {
      reject = r;
    });
    let elInternals: ElementInternals | null = null;
    component(tag, () => {
      resource(() => p);
      elInternals = internals();
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    await tick();
    const states = elInternals!.states as unknown as Set<string>;
    expect(states.has('error')).toBe(false);

    reject(new Error('boom'));
    await tick();
    await tick();
    expect(states.has('error')).toBe(true);
    warn.mockRestore();
  });

  it('two concurrent resources keep :state(loading) on until both settle', async () => {
    const tag = nextTag();
    let r1!: (v: string) => void;
    let r2!: (v: string) => void;
    const p1 = new Promise<string>((r) => {
      r1 = r;
    });
    const p2 = new Promise<string>((r) => {
      r2 = r;
    });
    let elInternals: ElementInternals | null = null;
    component(tag, () => {
      resource(() => p1, { key: 'a' });
      resource(() => p2, { key: 'b' });
      elInternals = internals();
      // Suppress unused-onDispose lint pattern — this just verifies the
      // import is wired in tests; binding lives on the resource.
      onDispose(() => {});
      return html`<div></div>`;
    });

    document.body.innerHTML = `<${tag}></${tag}>`;
    await tick();
    const states = elInternals!.states as unknown as Set<string>;
    expect(states.has('loading')).toBe(true);

    r1('one');
    await tick();
    await tick();
    expect(states.has('loading')).toBe(true); // still — r2 in flight

    r2('two');
    await tick();
    await tick();
    expect(states.has('loading')).toBe(false);
  });
});
