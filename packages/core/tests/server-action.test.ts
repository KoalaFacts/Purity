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
