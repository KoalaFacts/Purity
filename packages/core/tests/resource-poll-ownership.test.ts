import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { resource, type ResourceAccessor } from '../src/resource.ts';
import { state, watch } from '../src/signals.ts';
import { flushAll } from './_helpers.ts';

const stops: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

describe.each(['sync', 'resolve', 'reject', 'throw'] as const)(
  'resource polling ownership after %s',
  (settlement) => {
    it.each(['component', 'effect', 'explicit'] as const)(
      'releases the pending timer when its %s owner stops',
      async (owner) => {
        let calls = 0;
        const source = state(1);
        let result!: ResourceAccessor<number>;
        const start = () => {
          result = resource(
            source,
            () => {
              calls++;
              if (settlement === 'throw') throw new Error('expected');
              if (settlement === 'reject') return Promise.reject(new Error('expected'));
              return settlement === 'resolve' ? Promise.resolve(calls) : calls;
            },
            { pollInterval: 60_000 },
          );
        };
        let stop: () => void;
        if (owner === 'component') {
          stop = mount(() => {
            start();
            return document.createElement('p');
          }, document.createElement('div')).unmount;
        } else if (owner === 'effect') stop = watch(start);
        else {
          start();
          stop = () => result.dispose();
        }
        stops.push(stop);
        await flushAll();
        expect(calls).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        stop();
        expect(vi.getTimerCount()).toBe(0);
        source(2);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(calls).toBe(1);
      },
    );
  },
);

it.each(['resolve', 'reject'] as const)(
  'does not arm a poll after a %s observer disposes the resource',
  async (settlement) => {
    let settle!: () => void;
    const pending = new Promise<number>((resolve, reject) => {
      settle = () => {
        if (settlement === 'resolve') resolve(1);
        else reject(new Error('expected'));
      };
    });
    const result = resource(() => pending, { pollInterval: 60_000 });
    stops.push(result.dispose);
    const stop = watch(() => {
      if (result() !== undefined || result.error() !== undefined) result.dispose();
    });
    stops.push(stop);
    settle();
    await flushAll();
    expect(vi.getTimerCount()).toBe(0);
  },
);
