import { describe, expect, it } from 'vite-plus/test';
import { mount, onDispose, onError } from '../src/component.ts';
import { match } from '../src/control.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('match() failed branch recovery', () => {
  it('retries a failed fallback when its tracked dependency recovers', async () => {
    const selected = state<'ready' | 'missing'>('ready');
    const available = state(false);
    const failure = new Error('fallback unavailable');
    const caught: unknown[] = [];
    const host = document.createElement('div');
    const app = mount(() => {
      onError((error) => caught.push(error));
      return match(
        selected,
        { ready: () => document.createTextNode('Ready') },
        () => {
          if (!available()) throw failure;
          return document.createTextNode('Fallback recovered');
        },
      ) as DocumentFragment;
    }, host);

    try {
      expect(host.textContent).toBe('Ready');
      selected('missing');
      await tick();
      expect(caught).toEqual([failure]);
      expect(host.textContent).toBe('');

      // The selector is still "missing": only the failing fallback's
      // dependency changes. The failed key must not short-circuit the retry.
      available(true);
      await tick();
      expect(host.textContent).toBe('Fallback recovered');
      expect(caught).toEqual([failure]);
    } finally {
      app.unmount();
    }
  });

  it('retries the same key when a dependency of the failed branch recovers', async () => {
    const selected = state<'ready' | 'recovering'>('ready');
    const allowed = state(false);
    const failure = new Error('not ready');
    const caught: unknown[] = [];
    let failedBranchDisposals = 0;
    const host = document.createElement('div');
    const app = mount(() => {
      onError((error) => caught.push(error));
      return match(selected, {
        ready: () => document.createTextNode('Ready'),
        recovering: () => {
          onDispose(() => failedBranchDisposals++);
          if (!allowed()) throw failure;
          return document.createTextNode('Recovered');
        },
      }) as DocumentFragment;
    }, host);

    try {
      selected('recovering');
      await tick();
      expect(caught).toEqual([failure]);
      expect(host.textContent).toBe('');
      expect(failedBranchDisposals).toBe(1);

      // The failed branch read allowed(), so fixing that input should retry
      // without toggling the selector away and back.
      allowed(true);
      await tick();
      expect(host.textContent).toBe('Recovered');
      expect(caught).toEqual([failure]);
      expect(failedBranchDisposals).toBe(1);
    } finally {
      app.unmount();
    }
    expect(failedBranchDisposals).toBe(2);
  });
});
