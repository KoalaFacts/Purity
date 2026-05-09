import { afterEach, describe, expect, it } from 'vitest';
import { compute, state, watch } from '../src/signals.ts';

interface InspectorNode {
  kind: 'state' | 'computed' | 'effect';
  version: number;
  status?: 'clean' | 'check' | 'dirty';
  value: unknown;
  sources: InspectorNode[];
  observers: InspectorNode[];
}

interface InspectHook {
  version: 1;
  nodes(): InspectorNode[];
}

const hook = (): InspectHook | undefined =>
  (globalThis as { __purity_inspect__?: InspectHook }).__purity_inspect__;

describe('__purity_inspect__ hook', () => {
  // Effects/state created in tests aren't disposed by the framework when the
  // test ends — keep references local + dispose explicitly so the registry
  // doesn't bleed between tests.
  let disposers: Array<() => void> = [];
  afterEach(() => {
    for (const d of disposers) d();
    disposers = [];
  });

  it('is installed on globalThis in dev', () => {
    expect(hook()).toBeDefined();
    expect(hook()?.version).toBe(1);
  });

  it('exposes state nodes as kind: "state" with current value', () => {
    const _count = state(7);
    const all = hook()!.nodes();
    const mine = all.find((n) => n.kind === 'state' && n.value === 7);
    expect(mine).toBeDefined();
    expect(mine!.version).toBe(0);
  });

  it('reflects writes to state via version + value', () => {
    const count = state(0);
    count(5);
    const all = hook()!.nodes();
    const mine = all.find((n) => n.kind === 'state' && n.value === 5);
    expect(mine).toBeDefined();
    expect(mine!.version).toBeGreaterThan(0);
  });

  it('exposes computed nodes as kind: "computed" with status label', () => {
    const a = state(10);
    const b = compute(() => a() * 2);
    void b(); // force initial compute → status becomes "clean"
    const all = hook()!.nodes();
    const mine = all.find((n) => n.kind === 'computed' && n.value === 20);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe('clean');
  });

  it('exposes effect nodes as kind: "effect"', () => {
    const trigger = state(0);
    const stop = watch(() => {
      void trigger();
    });
    disposers.push(stop);
    const all = hook()!.nodes();
    const eff = all.find((n) => n.kind === 'effect');
    expect(eff).toBeDefined();
  });

  it('links computed to its sources reactively', () => {
    const x = state(3);
    const doubled = compute(() => x() * 2);
    void doubled();
    const all = hook()!.nodes();
    const computedNode = all.find((n) => n.kind === 'computed' && n.value === 6);
    expect(computedNode).toBeDefined();
    expect(computedNode!.sources.length).toBe(1);
    expect(computedNode!.sources[0].kind).toBe('state');
    expect(computedNode!.sources[0].value).toBe(3);
  });

  it('links state to its observer computeds', () => {
    const x = state(11);
    const c = compute(() => x() + 1);
    void c();
    const all = hook()!.nodes();
    const stateNode = all.find((n) => n.kind === 'state' && n.value === 11);
    expect(stateNode).toBeDefined();
    expect(stateNode!.observers.length).toBeGreaterThanOrEqual(1);
    expect(stateNode!.observers.some((o) => o.kind === 'computed')).toBe(true);
  });

  it('handles cycles via shared `seen` map (no infinite recursion)', () => {
    const a = state(1);
    const b = compute(() => a() * 2);
    void b();
    const nodes = hook()!.nodes();
    // The state is observed by the computed, and the computed has the state
    // as a source — that's a cycle in the graph view. Conversion must not
    // stack-overflow.
    expect(nodes.length).toBeGreaterThan(0);
    // Round-trip through the cycle: a state → its observer → that observer's
    // sources → back to the same state node (by reference identity).
    const stateNode = nodes.find((n) => n.kind === 'state' && n.value === 1);
    expect(stateNode).toBeDefined();
    const observed = stateNode!.observers[0];
    expect(observed.sources[0]).toBe(stateNode);
  });
});
