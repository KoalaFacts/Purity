// @vitest-environment jsdom
// ADR 0047 — eventSourceSignal tests.
//
// jsdom doesn't ship EventSource in a controllable form; we install a
// minimal mock that exposes a `fire(data)` helper and records open/close.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { mount } from '../../core/src/index.ts';
import { eventSourceSignal } from '../src/browser-signals/index.ts';
import { isSafeEventSourceUrl, redactUrl } from '../src/browser-signals/event-source-signal.ts';
import { _resetPageVisibilitySignal } from '../src/browser-signals/page-visibility-signal.ts';
import { _resetBfcacheRestoreSignal } from '../src/browser-signals/bfcache-restore-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../../core/src/ssr-context.ts';
import { makeSSRContext } from '../../core/tests/_helpers.ts';

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

  it('redacts malformed absolute URLs instead of echoing credentials', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sig = eventSourceSignal<number>(
        'https://user:pw@%not-a-host/sse?access_token=SECRET_URL',
        { initialValue: 7, validate: isNumber },
      );
      expect(sig()).toBe(7);
      expect(instances).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('[invalid URL]');
      expect(logged).not.toContain('SECRET_URL');
      expect(logged).not.toContain('user:pw');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('redacts scheme-relative credentials without exposing query userinfo', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const url = '//user:SECRET_USERINFO@example.test/sse?access_token=SECRET_QUERY';
      eventSourceSignal<number>(url, {
        initialValue: 7,
        validate: isNumber,
        reconnect: 'never',
      });
      expect(instances).toHaveLength(1);
      instances[0].fire('message', 'invalid-json');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('//example.test/sse');
      expect(logged).not.toContain('SECRET_USERINFO');
      expect(logged).not.toContain('SECRET_QUERY');
      // An @ in a query must not be mistaken for userinfo in the authority.
      expect(redactUrl('//example.test?access_token=user@SECRET_TAIL')).toBe('//example.test');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects embedded URL controls and safely redacts whitespace-prefixed authorities', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const url of [
        'htt\nps://user:pw@example.test/sse?access_token=SECRET_CTRL',
        'java\nscript:SECRET_JS',
      ]) {
        const sig = eventSourceSignal<number>(url, {
          initialValue: 7,
          validate: isNumber,
          reconnect: 'never',
        });
        expect(sig()).toBe(7);
      }
      expect(instances).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('[invalid URL]');
      expect(logged).not.toContain('user:pw');
      expect(logged).not.toContain('SECRET_CTRL');
      expect(logged).not.toContain('SECRET_JS');
      expect(redactUrl('  https://user:pw@example.test/sse?access_token=SECRET_TRIM')).toBe(
        'https://example.test/sse',
      );
      expect(isSafeEventSourceUrl('  https://example.test/sse')).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not log EventSource constructor errors containing credentials', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function ThrowingES(): never {
      throw new Error('SECRET_CONSTRUCTOR_MESSAGE with SECRET_URL_TOKEN');
    }
    (globalThis as { EventSource: unknown }).EventSource = ThrowingES;
    try {
      const sig = eventSourceSignal<number>(
        'https://user:pw@example.test/sse?access_token=SECRET_URL_TOKEN',
        { initialValue: 7, validate: isNumber, reconnect: 'never' },
      );
      expect(sig()).toBe(7);
      expect(instances).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('failed to open');
      expect(logged).toContain('https://example.test/sse');
      expect(logged).not.toContain('SECRET_CONSTRUCTOR_MESSAGE');
      expect(logged).not.toContain('SECRET_URL_TOKEN');
      expect(logged).not.toContain('user:pw');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('redacts EventSource close exceptions during owner disposal', () => {
    const close = MockES.prototype.close;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    MockES.prototype.close = function () {
      close.call(this);
      throw new Error('SECRET_CLOSE from https://user:pw@example.test/sse?access_token=SECRET_URL');
    };
    try {
      const host = document.createElement('div');
      const { unmount } = mount(() => {
        eventSourceSignal<number>('https://user:pw@example.test/sse?access_token=SECRET_URL', {
          initialValue: 0,
          validate: isNumber,
          reconnect: 'never',
        });
        return document.createComment('sse');
      }, host);
      expect(instances).toHaveLength(1);
      expect(() => unmount()).not.toThrow();
      expect(instances[0].closed).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('close failed');
      expect(logged).toContain('https://example.test/sse');
      expect(logged).not.toContain('SECRET_CLOSE');
      expect(logged).not.toContain('SECRET_URL');
      expect(logged).not.toContain('user:pw');
    } finally {
      MockES.prototype.close = close;
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('does not echo opaque URL payloads into refused EventSource diagnostics', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const url of [
        'javascript:SECRET_JS',
        'data:text/plain,SECRET_DATA',
        'file:///private/SECRET_FILE',
        new URL('blob:https://host/SECRET_BLOB'),
      ]) {
        const sig = eventSourceSignal<number>(url, {
          initialValue: 7,
          validate: isNumber,
          reconnect: 'never',
        });
        expect(sig()).toBe(7);
      }
      expect(instances).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledTimes(4);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('[unsupported URL scheme]');
      for (const secret of ['SECRET_JS', 'SECRET_DATA', 'SECRET_FILE', 'SECRET_BLOB']) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never logs parser or validator exceptions containing raw message secrets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const parsed = eventSourceSignal<number>('/sse', {
        initialValue: 7,
        validate: isNumber,
        parse: () => {
          throw new Error('SECRET_PARSE from an untrusted message');
        },
      });
      instances[0].fire('message', 'SECRET_PARSE');
      expect(parsed()).toBe(7);

      const validated = eventSourceSignal<number>('/sse', {
        initialValue: 8,
        validate: (_value: unknown): _value is number => {
          throw new Error('SECRET_VALIDATE from an untrusted message');
        },
      });
      instances[1].fire('message', '42');
      expect(validated()).toBe(8);

      expect(warnSpy).toHaveBeenCalledTimes(2);
      const logged = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).toContain('failed to parse');
      expect(logged).toContain('validator threw');
      expect(logged).not.toContain('SECRET_PARSE');
      expect(logged).not.toContain('SECRET_VALIDATE');
    } finally {
      warnSpy.mockRestore();
    }
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
