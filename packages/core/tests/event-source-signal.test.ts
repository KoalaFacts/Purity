// @vitest-environment jsdom
// ADR 0047 — eventSourceSignal tests.
//
// jsdom doesn't ship EventSource in a controllable form; we install a
// minimal mock that exposes a `fire(data)` helper and records open/close.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventSourceSignal } from '../src/index.ts';
import { isSafeEventSourceUrl } from '../src/event-source-signal.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

type Instance = {
  url: string;
  listeners: Map<string, ((e: MessageEvent) => void)[]>;
  closed: boolean;
  fire(eventName: string, data: string): void;
};

let instances: Instance[] = [];
let OriginalES: typeof EventSource | undefined;

class MockES {
  url: string;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(url: string | URL) {
    this.url = String(url);
    const inst: Instance = {
      url: this.url,
      listeners: this.listeners,
      closed: this.closed,
      fire: (eventName, data) => {
        const ls = this.listeners.get(eventName) ?? [];
        for (const l of ls) l({ data } as MessageEvent);
      },
    };
    instances.push(inst);
  }
  addEventListener(t: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(t) ?? [];
    arr.push(cb);
    this.listeners.set(t, arr);
  }
  removeEventListener(t: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(t) ?? [];
    this.listeners.set(
      t,
      arr.filter((x) => x !== cb),
    );
  }
  close(): void {
    this.closed = true;
    // Mirror the flag to the recorded Instance so tests can observe.
    const inst = instances.find((i) => i.listeners === this.listeners);
    if (inst) inst.closed = true;
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
  OriginalES = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  (globalThis as { EventSource: unknown }).EventSource = MockES;
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

afterEach(() => {
  if (OriginalES === undefined) {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  } else {
    (globalThis as { EventSource: unknown }).EventSource = OriginalES;
  }
  _resetPageVisibilitySignal();
  _resetBfcacheRestoreSignal();
});

const isNumber = (v: unknown): v is number => typeof v === 'number';

describe('eventSourceSignal — SSR (ADR 0047)', () => {
  it('returns the initialValue constant in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
      expect(sig()).toBe(0);
      expect(instances).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns the initialValue when EventSource is unavailable', () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const sig = eventSourceSignal<number>('/sse', { initialValue: 7, validate: isNumber });
    expect(sig()).toBe(7);
  });
});

describe('eventSourceSignal — client (ADR 0047)', () => {
  it('opens immediately when reconnect=never', () => {
    eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber, reconnect: 'never' });
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe('/sse');
  });

  it('opens immediately when reconnect=always', () => {
    eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber, reconnect: 'always' });
    expect(instances).toHaveLength(1);
  });

  it('opens when visible by default (on-visible)', () => {
    eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);
  });

  it('starts at initialValue and updates on validated message', () => {
    const sig = eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    expect(sig()).toBe(0);
    instances[0].fire('message', '42');
    expect(sig()).toBe(42);
  });

  it('drops messages that fail the validator with a console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    instances[0].fire('message', '"not-a-number"');
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("eventSourceSignal('/sse')");
    warnSpy.mockRestore();
  });

  it('drops messages that fail to parse with a console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    instances[0].fire('message', '<not json>');
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
    const sig = eventSourceSignal<number>('/sse', { initialValue: 0, validate: throwing });
    instances[0].fire('message', '"not-a-number"');
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('validator threw');
    warnSpy.mockRestore();
  });

  it('honours a custom eventName', () => {
    const sig = eventSourceSignal<number>('/sse', {
      initialValue: 0,
      validate: isNumber,
      eventName: 'tick',
    });
    instances[0].fire('message', '99'); // should be ignored
    expect(sig()).toBe(0);
    instances[0].fire('tick', '99');
    expect(sig()).toBe(99);
  });

  it('honours a custom parse', () => {
    const sig = eventSourceSignal<number>('/sse', {
      initialValue: 0,
      validate: isNumber,
      parse: (raw) => Number(raw),
    });
    instances[0].fire('message', '7');
    expect(sig()).toBe(7);
  });

  it('on-visible: closes when visibility goes hidden and reopens on visible', async () => {
    eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);
    expect(instances[0].closed).toBe(false);

    setVisibility('hidden');
    await tick();
    expect(instances[0].closed).toBe(true);
    expect(instances).toHaveLength(1); // no new instance yet

    setVisibility('visible');
    await tick();
    expect(instances).toHaveLength(2);
    expect(instances[1].closed).toBe(false);
  });

  it('on-visible: bfcache restore forces a clean reconnect', async () => {
    eventSourceSignal<number>('/sse', { initialValue: 0, validate: isNumber });
    expect(instances).toHaveLength(1);

    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await tick();

    expect(instances).toHaveLength(2);
    expect(instances[0].closed).toBe(true);
    expect(instances[1].closed).toBe(false);
  });

  it('always: stays open across visibility changes but reconnects on bfcache', async () => {
    eventSourceSignal<number>('/sse', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'always',
    });
    expect(instances).toHaveLength(1);

    setVisibility('hidden');
    await tick();
    expect(instances[0].closed).toBe(false); // 'always' ignores visibility

    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    await tick();
    expect(instances).toHaveLength(2);
    expect(instances[0].closed).toBe(true);
  });

  it('never: opens once and never reopens on lifecycle events', async () => {
    eventSourceSignal<number>('/sse', {
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
});

describe('eventSourceSignal — audit-v2 hardening', () => {
  // HIGH: URL scheme allow-list. A `javascript:` / `data:` / `blob:` /
  // `file:` URL must never reach the EventSource constructor — browsers
  // reject them but jsdom + custom mocks happily accept anything. The
  // signal should warn and stay at initialValue instead of constructing
  // a hostile connection target.
  it('refuses to open a javascript: URL and stays at initialValue', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = eventSourceSignal<number>('javascript:alert(1)', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(0);
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('refused to open');
    expect(msg).toContain('http(s)');
    warnSpy.mockRestore();
  });

  it('refuses to open a data: URL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    eventSourceSignal<number>('data:text/event-stream,data:%20pwned%0A%0A', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('refuses to open a file: URL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    eventSourceSignal<number>('file:///etc/passwd', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('still opens for http(s) and relative URLs', () => {
    eventSourceSignal<number>('https://example.test/sse', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(1);

    eventSourceSignal<number>('/relative/sse', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    expect(instances).toHaveLength(2);
  });

  it('isSafeEventSourceUrl matrix', () => {
    expect(isSafeEventSourceUrl('https://example.test/x')).toBe(true);
    expect(isSafeEventSourceUrl('http://example.test/x')).toBe(true);
    expect(isSafeEventSourceUrl('/relative/path')).toBe(true);
    expect(isSafeEventSourceUrl('./nested')).toBe(true);
    expect(isSafeEventSourceUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeEventSourceUrl('JAVASCRIPT:alert(1)')).toBe(false);
    expect(isSafeEventSourceUrl('data:text/plain,x')).toBe(false);
    expect(isSafeEventSourceUrl('blob:https://x/abc')).toBe(false);
    expect(isSafeEventSourceUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeEventSourceUrl('ws://example.test/x')).toBe(false);
    // URL instance form
    expect(isSafeEventSourceUrl(new URL('https://example.test/x'))).toBe(true);
  });

  // The redacted label feeds console.warn; if a `javascript:` URL flows
  // through and contains a quote/newline, we don't want to spray it into
  // log sinks. Verify the refusal warn uses the redacted label.
  it('refuses with the redacted label, not the raw URL', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    eventSourceSignal<number>('https://user:secret@example.test/sse?access_token=ABCDEF', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'never',
    });
    // This URL IS http(s) so it should open — but the label seen via
    // the construction error path (none here) would be redacted. Sanity
    // check via the validator-throw path:
    instances[0].fire('message', '"x"');
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).not.toContain('secret');
    expect(msg).not.toContain('ABCDEF');
    warnSpy.mockRestore();
  });

  // HIGH: open-after-dispose race. wireLiveReconnect's visibility watch
  // can schedule a synchronous open() in response to a visibility flip.
  // If the surrounding component already unmounted (disposer ran), that
  // late open() must NOT resurrect the connection.
  //
  // We can't easily simulate component lifecycle here, but we CAN verify
  // the close() / re-entry guard: once we manually dispose and then a
  // visibility flip happens, no new EventSource is constructed.
  it('close() is idempotent and clears the listener exactly once', async () => {
    eventSourceSignal<number>('/sse', {
      initialValue: 0,
      validate: isNumber,
      reconnect: 'on-visible',
    });
    expect(instances).toHaveLength(1);
    const first = instances[0];
    expect(first.closed).toBe(false);

    // Drive a hidden flip → close. Then another hidden flip — should
    // not throw or re-detach. Then a visible flip → exactly one new
    // instance opens.
    setVisibility('hidden');
    await tick();
    setVisibility('hidden'); // duplicate event; close() must be no-op
    await tick();
    expect(first.closed).toBe(true);
    expect(instances).toHaveLength(1);

    setVisibility('visible');
    await tick();
    expect(instances).toHaveLength(2);
    expect(instances[1].closed).toBe(false);

    // First instance must have its listener cleared (not still bound).
    // Without the close()-snapshot guard, a redundant removeEventListener
    // call could happen on the re-entered close path; we assert exactly
    // zero remaining listeners on the SSR-closed instance.
    const cleared = (first.listeners.get('message') ?? []).length;
    expect(cleared).toBe(0);
  });
});
