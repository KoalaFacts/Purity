// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { compute, state, watch } from '@purityjs/signals';
import { mount } from '../src/component.ts';
import { html } from '../src/compiler/compile.ts';
import { component } from '../src/elements.ts';

interface InspectorNode {
  kind: 'state' | 'computed' | 'effect';
  value: unknown;
  owner?: string[];
  source?: string;
  sources: InspectorNode[];
  observers: InspectorNode[];
}

interface InspectHook {
  version: 1;
  nodes(): InspectorNode[];
  captureSources(on: boolean): void;
}

const hook = (): InspectHook =>
  (globalThis as unknown as { __purity_inspect__: InspectHook }).__purity_inspect__;

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

const byValue = (value: unknown): InspectorNode | undefined =>
  hook()
    .nodes()
    .find((n) => n.value === value);

describe('__purity_inspect__ owner and source attribution (SV2-013)', () => {
  let disposers: Array<() => void> = [];
  afterEach(() => {
    hook().captureSources(false);
    for (const d of disposers) d();
    disposers = [];
  });

  it('records the owning component path of nodes created inside components', async () => {
    const marker = 'owner-path-marker';
    const Inner = component('p-attr-inner', () => {
      const local = state(marker);
      return html`<b>${() => local()}</b>`;
    });
    component('p-attr-outer', () => html`<div><p-attr-inner></p-attr-inner></div>`);
    expect(Inner).toBeTypeOf('function');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mount(() => html`<p-attr-outer></p-attr-outer>`, host);
    disposers.push(() => {
      mounted.unmount();
      host.remove();
    });
    await tick();
    const node = byValue(marker);
    expect(node?.kind).toBe('state');
    expect(node?.owner).toEqual(['p-attr-outer', 'p-attr-inner']);
    // The text binding effect reading it shares the owner path.
    const effect = node?.observers.find((o) => o.kind === 'effect');
    expect(effect?.owner).toEqual(['p-attr-outer', 'p-attr-inner']);
    // Mutating one snapshot never changes another node's path.
    (node!.owner as string[]).push('tampered');
    expect(byValue(marker)?.owner).toEqual(['p-attr-outer', 'p-attr-inner']);
  });

  it('names factory-called components by their mount root', () => {
    const marker = 'factory-owner-marker';
    const Factory = component('p-attr-factory', () => {
      const s = state(marker);
      return html`<em>${() => s()}</em>`;
    });
    const host = document.createElement('div');
    const mounted = mount(() => Factory({}), host);
    disposers.push(() => mounted.unmount());
    expect(byValue(marker)?.owner).toEqual(['#root', '#component']);
  });

  it('leaves owner undefined for nodes created outside any component', () => {
    const free = state('free-floating-marker');
    expect(free()).toBe('free-floating-marker');
    expect(byValue('free-floating-marker')?.owner).toBeUndefined();
  });

  it('does not keep a destroyed component alive through attribution', async () => {
    const marker = 'dead-owner-marker';
    let kept: (() => string) | null = null;
    const Leaf = component('p-attr-leaf', () => {
      const s = state(marker);
      kept = s;
      return html`<i>${() => s()}</i>`;
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mount(() => html`<p-attr-leaf></p-attr-leaf>`, host);
    await tick();
    expect(byValue(marker)?.owner).toEqual(['p-attr-leaf']);
    mounted.unmount();
    host.remove();
    expect(Leaf).toBeTypeOf('function');
    // Still readable while the state outlives its owner; the path is a
    // snapshot of names, not a live reference to the context.
    expect(kept!()).toBe(marker);
    expect(byValue(marker)?.owner).toEqual(['p-attr-leaf']);
  });

  it('captures no source by default', () => {
    state('no-source-marker');
    expect(byValue('no-source-marker')?.source).toBeUndefined();
  });

  it('captures the user creation site when captureSources(true) is on', () => {
    hook().captureSources(true);
    const s = state('source-marker');
    const c = compute(() => `${s()}-derived`);
    expect(c()).toBe('source-marker-derived');
    disposers.push(watch(() => c()));
    const node = byValue('source-marker');
    expect(node?.source).toMatch(/inspect-attribution\.test\.ts:\d+/);
    expect(node?.source).not.toMatch(/[\\/]signals[\\/]src[\\/]/);
    expect(byValue('source-marker-derived')?.source).toMatch(/inspect-attribution\.test\.ts:\d+/);
  });

  it('stops capturing after captureSources(false)', () => {
    hook().captureSources(true);
    state('captured-marker');
    hook().captureSources(false);
    state('uncaptured-marker');
    expect(byValue('captured-marker')?.source).toMatch(/inspect-attribution\.test\.ts/);
    expect(byValue('uncaptured-marker')?.source).toBeUndefined();
  });

  it('rejects a non-boolean captureSources argument', () => {
    expect(() => hook().captureSources('yes' as unknown as boolean)).toThrow(TypeError);
  });
});
