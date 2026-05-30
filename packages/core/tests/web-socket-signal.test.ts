// @vitest-environment jsdom
// ADR 0047 — webSocketSignal tests.
//
// jsdom doesn't ship WebSocket in usable form; we install a controllable
// mock that records send() calls, fires open/close/error/message on
// demand, and exposes the constructed instances.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, webSocketSignal } from '../src/index.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

type Instance = {
  url: string;
  protocols?: string | string[];
  sent: unknown[];
  closed: boolean;
  listeners: Map<string, ((e: Event | MessageEvent) => void)[]>;
  fireOpen(): void;
  fireClose(): void;
  fireError(): void;
  fireMessage(data: unknown): void;
};

let instances: Instance[] = [];
let OriginalWS: typeof WebSocket | undefined;

class MockWS {
  url: string;
  protocols?: string | string[];
  listeners = new Map<string, ((e: Event | MessageEvent) => void)[]>();
  sent: unknown[] = [];
  closed = false;
  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = String(url);
    this.protocols = protocols;
    const inst: Instance = {
      url: this.url,
      protocols,
      sent: this.sent,
      closed: this.closed,
      listeners: this.listeners,
      fireOpen: () => this.dispatch('open', new Event('open')),
      fireClose: () => this.dispatch('close', new Event('close')),
      fireError: () => this.dispatch('error', new Event('error')),
      fireMessage: (data) => this.dispatch('message', { data } as MessageEvent),
    };
    instances.push(inst);
  }
  addEventListener(t: string, cb: (e: Event | MessageEvent) => void): void {
    const arr = this.listeners.get(t) ?? [];
    arr.push(cb);
    this.listeners.set(t, arr);
  }
  removeEventListener(t: string, cb: (e: Event | MessageEvent) => void): void {
    const arr = this.listeners.get(t) ?? [];
    this.listeners.set(
      t,
      arr.filter((x) => x !== cb),
    );
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    const inst = instances.find((i) => i.listeners === this.listeners);
    if (inst) inst.closed = true;
  }
  private dispatch(t: string, e: Event | MessageEvent): void {
    const ls = this.listeners.get(t) ?? [];
    for (const l of ls) l(e);
  }
}

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  instances = [];
  OriginalWS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  (globalThis as { WebSocket: unknown }).WebSocket = MockWS;
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  if (OriginalWS === undefined) {
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
  } else {
    (globalThis as { WebSocket: unknown }).WebSocket = OriginalWS;
  }
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
});

const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';

describe('webSocketSignal — SSR (ADR 0047)', () => {
  it('returns an inert accessor in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
      expect(sig()).toBe(0);
      expect(sig.readyState()).toBe('closed');
      expect(() => sig.send('x')).not.toThrow();
      expect(instances).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns an inert accessor when WebSocket is unavailable', () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    const sig = webSocketSignal<number>('/ws', { initialValue: 7, validate: isNumber });
    expect(sig()).toBe(7);
    expect(sig.readyState()).toBe('closed');
    expect(() => sig.send('x')).not.toThrow();
  });
});

describe('webSocketSignal — client (ADR 0047)', () => {
  it('opens immediately and tracks readyState transitions', () => {
    const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);
    expect(sig.readyState()).toBe('connecting');
    instances[0].fireOpen();
    expect(sig.readyState()).toBe('open');
    instances[0].fireClose();
    expect(sig.readyState()).toBe('closed');
  });

  it('manual close transitions readyState through closing → closed (no stuck closing)', async () => {
    // The close() helper detaches the WS close listener BEFORE invoking
    // socket.close() (cycle-8 fix to stop late messages riding back in
    // on reconnect). Side effect: the close-event-driven path that used
    // to settle `closed` no longer runs — readyState stayed on 'closing'
    // forever. Test via the cycle-1 ctx auto-close (mount + unmount).
    const host = document.createElement('div');
    let observed: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
    let sig: ReturnType<typeof webSocketSignal<number>> | null = null;
    const { unmount } = mount(() => {
      sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
      observed = sig.readyState();
      return document.createComment('m');
    }, host);
    expect(sig).not.toBeNull();
    instances[0].fireOpen();
    expect(sig!.readyState()).toBe('open');
    // Auto-close on unmount runs close() — pre-fix, readyState would
    // stick on 'closing'.
    unmount();
    expect(sig!.readyState()).toBe('closing');
    // After one microtask, the close path's queueMicrotask flush runs.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(sig!.readyState()).toBe('closed');
    void observed; // exercise the closure-capture, no-op assertion
  });

  it('starts at initialValue and updates on validated message', () => {
    const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    instances[0].fireOpen();
    expect(sig()).toBe(0);
    instances[0].fireMessage('42'); // parse → 42
    expect(sig()).toBe(42);
  });

  it('drops messages that fail the validator with a console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    instances[0].fireOpen();
    instances[0].fireMessage('"not-a-number"');
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("webSocketSignal('/ws')");
    warnSpy.mockRestore();
  });

  it('redacts secrets in the URL before logging (no access_token / userinfo leak)', () => {
    // SSE/WS auth via `?access_token=…` is common (they can't set
    // headers). Pre-fix `label = String(url)` interpolated the full
    // URL — including the token — into every console.warn. Production
    // log sinks then captured it. Redact: keep protocol + host + path
    // only.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = webSocketSignal<number>('ws://user:pw@host/api?access_token=SECRET', {
      initialValue: 0,
      validate: isNumber,
    });
    instances[0].fireOpen();
    instances[0].fireMessage('"bad"');
    expect(sig()).toBe(0);
    // Logs must NOT contain the secret query string or userinfo.
    for (const call of warnSpy.mock.calls) {
      const line = call.map(String).join(' ');
      expect(line).not.toContain('SECRET');
      expect(line).not.toContain('access_token');
      expect(line).not.toContain('user:pw');
    }
    // But the label should still be useful (protocol + host + path).
    expect(warnSpy.mock.calls[0][0]).toContain('ws://host/api');
    warnSpy.mockRestore();
  });

  it('drops messages that fail to parse with a console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    instances[0].fireOpen();
    instances[0].fireMessage('<not json>');
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('failed to parse');
    warnSpy.mockRestore();
  });

  it('drops the message and logs when the validator THROWS', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = ((v: unknown): v is number => {
      if (typeof v !== 'number') throw new TypeError('nope');
      return true;
    }) as (v: unknown) => v is number;
    const sig = webSocketSignal<number>('/ws', { initialValue: 0, validate: throwing });
    instances[0].fireOpen();
    instances[0].fireMessage('"not-a-number"');
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('validator threw');
    warnSpy.mockRestore();
  });

  it('send() forwards to the socket when open', () => {
    const sig = webSocketSignal<string>('/ws', { initialValue: '', validate: isString });
    instances[0].fireOpen();
    sig.send('hello');
    expect(instances[0].sent).toEqual(['hello']);
  });

  it('send() warns and drops when the socket is not open', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = webSocketSignal<string>('/ws', { initialValue: '', validate: isString });
    // Still 'connecting' — fireOpen not called.
    sig.send('queued?');
    expect(instances[0].sent).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('not open');
    // After close, same behavior.
    instances[0].fireOpen();
    instances[0].fireClose();
    sig.send('after-close');
    expect(instances[0].sent).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it('honours a custom parse', () => {
    const sig = webSocketSignal<number>('/ws', {
      initialValue: 0,
      validate: isNumber,
      parse: (raw) => Number(raw),
    });
    instances[0].fireOpen();
    instances[0].fireMessage('7');
    expect(sig()).toBe(7);
  });

  it('on-visible: closes when visibility goes hidden and reopens on visible', async () => {
    webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);
    expect(instances[0].closed).toBe(false);

    setVisibility('hidden');
    await tick();
    expect(instances[0].closed).toBe(true);
    expect(instances).toHaveLength(1);

    setVisibility('visible');
    await tick();
    expect(instances).toHaveLength(2);
    expect(instances[1].closed).toBe(false);
  });

  it('on-visible: bfcache restore forces a clean reconnect', async () => {
    webSocketSignal<number>('/ws', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);

    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await tick();

    expect(instances).toHaveLength(2);
    expect(instances[0].closed).toBe(true);
    expect(instances[1].closed).toBe(false);
  });

  it('never: opens once and never reopens on lifecycle events', async () => {
    webSocketSignal<number>('/ws', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(1);

    setVisibility('hidden');
    await tick();
    setVisibility('visible');
    await tick();
    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await tick();

    expect(instances).toHaveLength(1);
  });

  it('forwards protocols to the WebSocket constructor', () => {
    webSocketSignal<number>('/ws', {
      initialValue: 0,
      validate: isNumber,
      protocols: ['v1', 'v2'],
    });
    expect(instances[0].protocols).toEqual(['v1', 'v2']);
  });

  it('close() detaches the four listeners so a late message after reconnect cannot ride into the new state', async () => {
    const sig = webSocketSignal<number>('/ws', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'on-visible',
    });
    expect(instances).toHaveLength(1);
    const first = instances[0];
    first.fireOpen();
    first.fireMessage(7);
    expect(sig()).toBe(7);

    // Trigger the close path via hidden visibility.
    setVisibility('hidden');
    await tick();

    // All four of our listeners should be detached from the old socket.
    expect(first.listeners.get('open')?.length ?? 0).toBe(0);
    expect(first.listeners.get('close')?.length ?? 0).toBe(0);
    expect(first.listeners.get('error')?.length ?? 0).toBe(0);
    expect(first.listeners.get('message')?.length ?? 0).toBe(0);

    // Reconnect: a NEW socket opens.
    setVisibility('visible');
    await tick();
    expect(instances).toHaveLength(2);

    // The OLD socket dispatches a late message (real-world: in-flight bytes
    // arrive after close() but before the close handshake completes). With
    // the leak, this would update the shared inner state to 99. With the
    // fix the listeners are gone — the new socket's 42 wins.
    first.fireMessage(99);
    instances[1].fireOpen();
    instances[1].fireMessage(42);
    expect(sig()).toBe(42);
  });
});
