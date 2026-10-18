import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { hydrate, mount, onDispose, onError, onMount } from '../src/component.ts';
import { component } from '../src/elements.ts';
import { getCurrentContext } from '../src/scope.ts';
import { state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const stops: (() => void)[] = [];
let nextTag = 0;
const modes = [
  'custom element',
  'hydrated element',
  'factory',
  'factory with slots',
  'factory in element',
] as const;

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function start(mode: (typeof modes)[number], render: () => Node): () => void {
  const name = `p-mounted-owner-${nextTag++}`;
  const Child = component(name, render);
  if (mode === 'factory' || mode === 'factory with slots') {
    const host = document.createElement('div');
    const handle = mount(
      () => Child({}, mode === 'factory with slots' ? () => 'slot' : undefined),
      host,
    );
    return handle.unmount;
  }
  const hostName = `${name}-host`;
  if (mode === 'factory in element') component(hostName, () => Child({}));
  const el = document.createElement(mode === 'factory in element' ? hostName : name);
  let adopted: Node | null = null;
  if (mode === 'hydrated element') {
    el.shadowRoot!.innerHTML = '<p>owned</p>';
    adopted = el.shadowRoot!.firstChild;
  }
  if (adopted) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.appendChild(el);
    const handle = hydrate(host, () => el);
    expect(el.shadowRoot!.firstChild).toBe(adopted);
    return () => {
      handle.unmount();
      host.remove();
    };
  }
  document.body.appendChild(el);
  return () => el.remove();
}

describe.each(modes)('mounted callback ownership: %s', (mode) => {
  it('disposes reactive work registered inside mounted callbacks', async () => {
    const value = state(0);
    let callbacks = 0;
    let runs = 0;
    let disposals = 0;
    const stop = start(mode, () => {
      onMount(() => {
        callbacks++;
        stops.push(
          watch(() => {
            value();
            runs++;
          }),
        );
        onDispose(() => disposals++);
      });
      return html`<p>owned</p>`;
    });
    stops.push(stop);
    await tick();
    expect(callbacks).toBe(mode === 'factory with slots' ? 2 : 1);
    value(1);
    await tick();
    expect(runs).toBe(callbacks * 2);
    stop();
    value(2);
    await tick();
    expect(disposals).toBe(callbacks);
    expect(runs).toBe(callbacks * 2);
    expect(getCurrentContext()).toBeNull();
  });

  it('cancels queued mounted callbacks when removed before the microtask', async () => {
    let calls = 0;
    const stop = start(mode, () => {
      onMount(() => calls++);
      return html`<p>owned</p>`;
    });
    stops.push(stop);
    stop();
    await tick();
    expect(calls).toBe(0);
    expect(getCurrentContext()).toBeNull();
  });

  it('stops the remaining mounted callbacks when the first removes its owner', async () => {
    let staleCalls = 0;
    let stop: () => void = () => {};
    stop = start(mode, () => {
      onMount(() => stop());
      onMount(() => staleCalls++);
      return html`<p>owned</p>`;
    });
    stops.push(stop);
    await tick();
    expect(staleCalls).toBe(0);
    expect(getCurrentContext()).toBeNull();
  });
});

it('does not inherit a destroyed boundary when a mounted element reconnects', () => {
  const queued: (() => void)[] = [];
  const scheduler = vi
    .spyOn(globalThis, 'queueMicrotask')
    .mockImplementation((fn) => queued.push(fn));
  const original = new Error('new instance failed');
  const staleBoundary = vi.fn();
  const destination = document.createElement('div');
  const name = `p-mounted-owner-${nextTag++}`;
  let generation = 0;
  let element: HTMLElement | undefined;
  try {
    component(name, () => {
      const current = ++generation;
      if (current === 1) onError(staleBoundary);
      onMount(() => {
        if (current === 1) destination.appendChild(element!);
        else throw original;
      });
      return html`<p>owned</p>`;
    });
    document.body.appendChild(destination);
    element = document.createElement(name);
    document.body.appendChild(element);
    expect(queued).toHaveLength(1);
    queued.shift()!();
    expect(generation).toBe(2);
    expect(queued).toHaveLength(1);
    expect(() => queued.shift()!()).toThrow(original);
    expect(staleBoundary).not.toHaveBeenCalled();
    expect(getCurrentContext()).toBeNull();
  } finally {
    element?.remove();
    destination.remove();
    scheduler.mockRestore();
  }
});
