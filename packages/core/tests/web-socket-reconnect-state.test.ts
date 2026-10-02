// @vitest-environment jsdom
// An old close microtask must not mark a replacement WebSocket closed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { mount, webSocketSignal } from '../src/index.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';

type ReconnectPolicy = 'on-visible' | 'always';

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  closed = false;
  sent: string[] = [];

  constructor(_url: string | URL, _protocols?: string | string[]) {
    super();
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

let unmount: (() => void) | undefined;
const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

function createFeed(reconnect: ReconnectPolicy) {
  let feed!: ReturnType<typeof webSocketSignal<number>>;
  const mounted = mount(() => {
    feed = webSocketSignal<number>('/ws', {
      initialValue: 0,
      validate: (value): value is number => typeof value === 'number',
      reconnect,
    });
    return document.createComment('websocket reconnect regression');
  }, document.createElement('div'));
  unmount = mounted.unmount;
  return feed;
}

function restoreFromBfcache(): void {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  window.dispatchEvent(event);
}

beforeEach(() => {
  MockWebSocket.instances = [];
  unmount = undefined;
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  unmount?.();
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
  vi.unstubAllGlobals();
});

describe('webSocketSignal replacement state', () => {
  it.each(['on-visible', 'always'] as const)(
    'keeps the replacement connecting after a bfcache restore (%s)',
    async (reconnect) => {
      const feed = createFeed(reconnect);
      const original = MockWebSocket.instances[0];
      original.dispatchEvent(new Event('open'));
      expect(feed.readyState()).toBe('open');

      restoreFromBfcache();
      await tick();
      await tick();

      expect(original.closed).toBe(true);
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(feed.readyState()).toBe('connecting');

      const replacement = MockWebSocket.instances[1];
      replacement.dispatchEvent(new Event('open'));
      feed.send('resume');
      expect(feed.readyState()).toBe('open');
      expect(replacement.sent).toEqual(['resume']);
    },
  );

  it.each(['on-visible', 'always'] as const)(
    'keeps the latest connection state across repeated restores (%s)',
    async (reconnect) => {
      const feed = createFeed(reconnect);
      restoreFromBfcache();
      await tick();
      await tick();
      restoreFromBfcache();
      await tick();
      await tick();

      expect(MockWebSocket.instances).toHaveLength(3);
      expect(MockWebSocket.instances[0].closed).toBe(true);
      expect(MockWebSocket.instances[1].closed).toBe(true);
      expect(feed.readyState()).toBe('connecting');
    },
  );

  it('still settles to closed when there is no replacement on unmount', async () => {
    const feed = createFeed('always');
    MockWebSocket.instances[0].dispatchEvent(new Event('open'));
    unmount?.();
    unmount = undefined;
    expect(feed.readyState()).toBe('closing');
    await tick();
    expect(feed.readyState()).toBe('closed');
  });
});
