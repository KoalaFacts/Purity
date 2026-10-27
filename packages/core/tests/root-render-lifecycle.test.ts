import { describe, expect, it } from 'vite-plus/test';
import { hydrate, mount, onDestroy, onDispose, onError, onMount } from '../src/component.ts';
import { getCurrentContext } from '../src/scope.ts';
import { state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('SV2-015 shared root render lifecycle', () => {
  for (const mode of ['mount', 'hydrate'] as const) {
    it(`${mode} preserves mounted callbacks and releases the root ownership graph`, async () => {
      const host = document.createElement('div');
      if (mode === 'hydrate') host.innerHTML = '<p>server</p>';
      const source = state(0);
      const events: string[] = [];
      const previousOwner = getCurrentContext();

      const render = () => {
        onMount(() => events.push('mounted'));
        onDispose(() => events.push('disposed'));
        onDestroy(() => events.push('destroyed'));
        watch(() => events.push(`value:${source()}`));
        return document.createElement('p');
      };

      const handle = mode === 'mount' ? mount(render, host) : hydrate(host, render);
      expect(getCurrentContext()).toBe(previousOwner);
      expect(events).toEqual(['value:0']);
      await tick();
      expect(events).toEqual(['value:0', 'mounted']);

      source(1);
      await tick();
      expect(events).toContain('value:1');
      handle.unmount();
      handle.unmount();
      expect(events).toContain('disposed');
      expect(events).toContain('destroyed');
      const before = events.length;
      source(2);
      await tick();
      expect(events).toHaveLength(before);
    });

    it(`${mode} reports a failed render once, releases its effects and skips destroy`, async () => {
      const host = document.createElement('div');
      if (mode === 'hydrate') host.innerHTML = '<p>server</p>';
      const source = state(0);
      const events: string[] = [];
      const previousOwner = getCurrentContext();
      const render = (): Node => {
        onError((err) => events.push(err instanceof Error ? err.message : String(err)));
        onDispose(() => events.push('disposed'));
        onDestroy(() => events.push('destroyed'));
        watch(() => events.push(`value:${source()}`));
        throw new Error('render failed');
      };

      const handle = mode === 'mount' ? mount(render, host) : hydrate(host, render);
      expect(getCurrentContext()).toBe(previousOwner);
      expect(events).toEqual(['value:0', 'render failed', 'disposed']);
      handle.unmount();
      source(1);
      await tick();
      expect(events).toEqual(['value:0', 'render failed', 'disposed']);
    });
  }
});
