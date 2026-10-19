import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { resource } from '../src/resource.ts';
import { state, watch } from '../src/signals.ts';
import { flushAll } from './_helpers.ts';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

it.each(['false', 'null', 'undefined', 'throw'] as const)(
  'cancels a pending request when the source becomes %s',
  async (disabled) => {
    const enabled = state(true);
    const failure = new Error('source failed');
    let signal!: AbortSignal;
    let resolve!: (value: string) => void;
    const result = resource(
      () => {
        if (enabled()) return 'key';
        if (disabled === 'throw') throw failure;
        if (disabled === 'false') return false;
        if (disabled === 'null') return null;
        return undefined;
      },
      (_key, info) => {
        signal = info.signal;
        return new Promise<string>((done) => {
          resolve = done;
        });
      },
    );
    stops.push(result.dispose);
    enabled(false);
    await flushAll();
    expect(signal.aborted).toBe(true);
    resolve('stale');
    await flushAll();
    expect(result()).toBeUndefined();
    expect(result.loading()).toBe(false);
    expect(result.error()).toBe(disabled === 'throw' ? failure : undefined);
  },
);

describe.each(['resolve', 'reject'] as const)('pending request %s', (settlement) => {
  it('settles after source dependencies change without changing the key', async () => {
    const dependency = state(0);
    const failure = new Error('fetch failed');
    let calls = 0;
    let signal!: AbortSignal;
    let settle!: () => void;
    const result = resource(
      () => {
        dependency();
        return 'same-key';
      },
      (_key, info) => {
        calls++;
        signal = info.signal;
        return new Promise<string>((resolve, reject) => {
          settle = () => (settlement === 'resolve' ? resolve('ok') : reject(failure));
        });
      },
    );
    stops.push(result.dispose);
    dependency(1);
    await flushAll();
    dependency(2);
    await flushAll();
    expect(calls).toBe(1);
    expect(signal.aborted).toBe(false);
    settle();
    await flushAll();
    expect(result.loading()).toBe(false);
    expect(result()).toBe(settlement === 'resolve' ? 'ok' : undefined);
    expect(result.error()).toBe(settlement === 'reject' ? failure : undefined);
  });
});

it('retains an in-progress retry delay across same-key source invalidations', async () => {
  vi.useFakeTimers();
  const dependency = state(0);
  let calls = 0;
  const result = resource(
    () => {
      dependency();
      return 'same-key';
    },
    () => {
      if (++calls === 1) return Promise.reject(new Error('retry'));
      return Promise.resolve('ok');
    },
    { retry: { count: 1, delay: () => 100 } },
  );
  stops.push(result.dispose);
  await flushAll();
  expect(vi.getTimerCount()).toBe(1);
  dependency(1);
  await flushAll();
  await vi.advanceTimersByTimeAsync(100);
  expect(calls).toBe(2);
  expect(result()).toBe('ok');
  expect(result.loading()).toBe(false);
});

it.each(['component', 'effect'] as const)(
  'still cancels the retained same-key request when its %s owner stops',
  async (owner) => {
    const dependency = state(0);
    let signal!: AbortSignal;
    const start = () => {
      resource(
        () => {
          dependency();
          return 'same-key';
        },
        (_key, info) => {
          signal = info.signal;
          return new Promise(() => {});
        },
      );
    };
    const stop =
      owner === 'effect'
        ? watch(start)
        : mount(() => {
            start();
            return document.createElement('p');
          }, document.createElement('div')).unmount;
    stops.push(stop);
    dependency(1);
    await flushAll();
    expect(signal.aborted).toBe(false);
    stop();
    expect(signal.aborted).toBe(true);
  },
);

it('does not start a replacement when the previous abort listener disposes the resource', async () => {
  const key = state(0);
  let calls = 0;
  const result = resource(key, (_key, { signal }) => {
    calls++;
    signal.addEventListener('abort', () => result.dispose(), { once: true });
    return new Promise(() => {});
  });
  stops.push(result.dispose);
  key(1);
  await flushAll();
  expect(calls).toBe(1);
  expect(result.loading()).toBe(false);
});

it('does not subscribe an auto-tracked fetch to reads in the prior abort listener', async () => {
  const key = state(0);
  const unrelated = state(0);
  let calls = 0;
  const result = resource(({ signal }) => {
    key();
    calls++;
    signal.addEventListener('abort', () => unrelated(), { once: true });
    return new Promise(() => {});
  });
  stops.push(result.dispose);
  key(1);
  await flushAll();
  expect(calls).toBe(2);
  unrelated(1);
  await flushAll();
  expect(calls).toBe(2);
});
