// @vitest-environment jsdom
// Tests for `serverAction` / `findAction` / `handleAction`. ADR 0012.

import { afterEach, describe, expect, it } from 'vitest';
import { findAction, handleAction, serverAction } from '../src/index.ts';
import { _clearActionRegistry } from '../src/server-action.ts';

afterEach(() => {
  _clearActionRegistry();
});

describe('serverAction() — registration', () => {
  it('returns the action with the supplied url + handler', () => {
    const handler = async () => new Response('ok');
    const action = serverAction('/api/test', handler);
    expect(action.url).toBe('/api/test');
    expect(action.handler).toBe(handler);
  });

  it('rejects empty / non-string urls', () => {
    expect(() => serverAction('', async () => new Response())).toThrow(/non-empty/);
    // @ts-expect-error — runtime check covers misuse from non-TS callers.
    expect(() => serverAction(undefined, async () => new Response())).toThrow(/non-empty/);
  });

  it('rejects non-function handlers', () => {
    // @ts-expect-error — runtime check
    expect(() => serverAction('/x', null)).toThrow(/must be a function/);
  });

  it('last call wins on duplicate URL (HMR-friendly)', async () => {
    serverAction('/api/dup', async () => new Response('first'));
    serverAction('/api/dup', async () => new Response('second'));
    const res = await handleAction(new Request('https://example.com/api/dup', { method: 'POST' }));
    expect(await res?.text()).toBe('second');
  });
});

describe('findAction() — lookup', () => {
  it('finds by url pathname (ignoring query/hash)', () => {
    const action = serverAction('/api/save', async () => new Response());
    const handler = findAction(new Request('https://example.com/api/save?id=1#x'));
    expect(handler).toBe(action.handler);
  });

  it('returns null when no handler matches', () => {
    serverAction('/api/save', async () => new Response());
    const handler = findAction(new Request('https://example.com/api/missing'));
    expect(handler).toBeNull();
  });
});

describe('handleAction() — dispatch', () => {
  it('invokes the handler and returns its Response', async () => {
    serverAction('/api/echo', async (req) => {
      const data = await req.formData();
      return new Response(`hello, ${data.get('name')}`);
    });

    const form = new FormData();
    form.set('name', 'Ada');
    const res = await handleAction(
      new Request('https://example.com/api/echo', { method: 'POST', body: form }),
    );
    expect(res).not.toBeNull();
    expect(await res?.text()).toBe('hello, Ada');
  });

  it('returns null on unknown route so the caller can fall through to SSR', async () => {
    const res = await handleAction(new Request('https://example.com/api/missing'));
    expect(res).toBeNull();
  });

  it('supports synchronous Response returns', async () => {
    serverAction('/api/sync', () => new Response('sync-ok'));
    const res = await handleAction(new Request('https://example.com/api/sync'));
    expect(await res?.text()).toBe('sync-ok');
  });

  it('propagates handler errors so the caller can wrap them', async () => {
    serverAction('/api/boom', async () => {
      throw new Error('boom');
    });
    await expect(
      handleAction(new Request('https://example.com/api/boom', { method: 'POST' })),
    ).rejects.toThrow(/boom/);
  });
});

describe('progressive form enhancement pattern', () => {
  it('Post-Redirect-Get flow returns a 303 with the right Location', async () => {
    serverAction('/api/save', (req) => {
      // 303 → browser does a GET to the Location.
      return Response.redirect(new URL('/?saved=1', req.url).toString(), 303);
    });

    const res = await handleAction(
      new Request('https://example.com/api/save', { method: 'POST', body: new FormData() }),
    );
    expect(res?.status).toBe(303);
    expect(res?.headers.get('location')).toBe('https://example.com/?saved=1');
  });
});

describe('action.invoke() — client-side fetch helper', () => {
  it('defaults to POST and calls fetch with the action URL', async () => {
    const action = serverAction('/api/echo', async (req) => {
      const data = await req.formData();
      return new Response(`got ${data.get('x')}`);
    });

    const form = new FormData();
    form.set('x', 'hi');

    // jsdom ships fetch in newer versions — but to keep the test stable
    // we stub it and just verify the call shape.
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('stubbed');
    }) as typeof fetch;

    try {
      const res = await action.invoke(form);
      expect(res).toBeInstanceOf(Response);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/api/echo');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.body).toBe(form);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('honors init overrides (method, headers, credentials)', async () => {
    const action = serverAction('/api/x', async () => new Response());
    const originalFetch = globalThis.fetch;
    let captured: RequestInit | null = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      captured = init;
      return new Response();
    }) as typeof fetch;

    try {
      await action.invoke('{"k":"v"}', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
      });
      expect(captured).not.toBeNull();
      const c = captured as RequestInit;
      expect(c.method).toBe('PUT');
      expect((c.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(c.credentials).toBe('include');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('passes null body through cleanly when omitted', async () => {
    const action = serverAction('/api/null', async () => new Response());
    const originalFetch = globalThis.fetch;
    let captured: RequestInit | null = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      captured = init;
      return new Response();
    }) as typeof fetch;

    try {
      await action.invoke();
      expect(captured?.body).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('round-trips through the real handler via fetch + handleAction (end-to-end)', async () => {
    // Wire a stub fetch that routes back through handleAction so the
    // handler runs as it would in production.
    const action = serverAction('/api/echo2', async (req) => {
      const data = await req.formData();
      return new Response(`hello ${data.get('name')}`);
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      // Map the fetch call back into a real Request the handler accepts.
      const req = new Request(`http://localhost${url}`, init);
      const res = await handleAction(req);
      return res ?? new Response('not found', { status: 404 });
    }) as typeof fetch;

    try {
      const form = new FormData();
      form.set('name', 'Ada');
      const res = await action.invoke(form);
      expect(await res.text()).toBe('hello Ada');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws clearly on the server (no window / no fetch)', async () => {
    const action = serverAction('/api/server-only', async () => new Response());
    // Simulate server: drop window so invoke() bails.
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      await expect(action.invoke(null)).rejects.toThrow(/client-only/);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
