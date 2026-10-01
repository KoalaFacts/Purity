import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

describe('inspector registry retention', () => {
  let previousHook: PropertyDescriptor | undefined;
  beforeEach(() => {
    previousHook = Object.getOwnPropertyDescriptor(globalThis, '__purity_inspect__');
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (previousHook) Object.defineProperty(globalThis, '__purity_inspect__', previousHook);
    else delete (globalThis as { __purity_inspect__?: unknown }).__purity_inspect__;
  });

  function hook() {
    return (globalThis as unknown as { __purity_inspect__: { nodes(): { value: unknown }[] } })
      .__purity_inspect__;
  }

  it('removes only the finalized entry and tolerates a repeated callback', async () => {
    let finalize!: (ref: WeakRef<object>) => void;
    const registrations: { target: object; ref: WeakRef<object> }[] = [];
    class TestFinalizationRegistry {
      constructor(callback: typeof finalize) {
        finalize = callback;
      }
      register(target: object, ref: WeakRef<object>): void {
        registrations.push({ target, ref });
      }
    }
    vi.stubGlobal('FinalizationRegistry', TestFinalizationRegistry);
    const { state } = await import('../src/signals.ts');
    const transient = state({ marker: 'transient' });
    const survivor = state({ marker: 'survivor' });
    expect(registrations).toHaveLength(2);
    expect(registrations[0].ref.deref()).toBe(registrations[0].target);
    expect(
      hook()
        .nodes()
        .map((node) => node.value),
    ).toEqual([transient(), survivor()]);
    // Simulate callback delivery deterministically; the stress check covers real GC.
    finalize(registrations[0].ref);
    finalize(registrations[0].ref);
    expect(
      hook()
        .nodes()
        .map((node) => node.value),
    ).toEqual([survivor()]);
    expect(survivor()).toEqual({ marker: 'survivor' });
  });

  it('registers state, computed and effect nodes with WeakRef held values', async () => {
    const held: { target: object; ref: WeakRef<object> }[] = [];
    class TestFinalizationRegistry {
      register(target: object, ref: WeakRef<object>): void {
        held.push({ target, ref });
      }
    }
    vi.stubGlobal('FinalizationRegistry', TestFinalizationRegistry);
    const { state, compute, watch } = await import('../src/signals.ts');
    const count = state(1);
    const doubled = compute(() => count() * 2);
    const stop = watch(() => {
      void doubled();
    });
    try {
      expect(held).toHaveLength(3);
      for (const { target, ref } of held) {
        expect(ref).toBeInstanceOf(WeakRef);
        expect(ref.deref()).toBe(target);
        expect(typeof target).toBe('object');
      }
    } finally {
      stop();
    }
  });

  it('works without FinalizationRegistry and prunes dead entries when inspected', async () => {
    const refs: ControlledWeakRef<object>[] = [];
    class ControlledWeakRef<T extends object> {
      target: T | undefined;
      constructor(target: T) {
        this.target = target;
        refs.push(this);
      }
      deref(): T | undefined {
        return this.target;
      }
    }
    vi.stubGlobal('FinalizationRegistry', undefined);
    vi.stubGlobal('WeakRef', ControlledWeakRef);
    const { state } = await import('../src/signals.ts');
    const transient = state('transient');
    const survivor = state('survivor');
    expect(
      hook()
        .nodes()
        .map((node) => node.value),
    ).toEqual([transient(), survivor()]);
    const previousTarget = refs[0].target;
    refs[0].target = undefined; // Deterministic stand-in for collection, not a real GC claim.
    expect(
      hook()
        .nodes()
        .map((node) => node.value),
    ).toEqual([survivor()]);
    // A deleted entry stays absent even if the controlled ref is later changed.
    refs[0].target = previousTarget;
    expect(
      hook()
        .nodes()
        .map((node) => node.value),
    ).toEqual([survivor()]);
    expect(survivor()).toBe('survivor');
  });
});
