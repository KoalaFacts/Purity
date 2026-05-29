// @vitest-environment jsdom
// ADR 0049 — optimistic() wrapper tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { optimistic, query, serverAction } from '../src/index.ts';
import { _resetQueryCache } from '../src/query.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { _resetOnlineSignal } from '../src/online-signal.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { _clearActionRegistry } from '../src/server-action.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const drain = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};

beforeEach(() => {
  _resetQueryCache();
  _resetPageVisibilitySignal();
  _resetOnlineSignal();
  _resetBfcacheRestoreSignal();
  _clearActionRegistry();
});

afterEach(() => {
  _resetQueryCache();
  _resetPageVisibilitySignal();
  _resetOnlineSignal();
  _resetBfcacheRestoreSignal();
  _clearActionRegistry();
});

/**
 * Build a serverAction whose `invoke()` we override to return a controllable
 * response without touching fetch.
 */
function makeFakeAction(
  url: string,
  respond: (body: BodyInit | null) => Response | Promise<Response>,
) {
  const a = serverAction(url, async () => new Response('unused'));
  // Override invoke to bypass the fetch round-trip — we test the wrapper, not fetch.
  (a as { invoke: (body?: BodyInit | null) => Promise<Response> }).invoke = async (body) =>
    respond(body ?? null);
  return a;
}

describe('optimistic — happy path (ADR 0049)', () => {
  it('forwards url + body, returns the wrapped response', async () => {
    let sawBody: unknown = null;
    const act = makeFakeAction('/act-1', (body) => {
      sawBody = body;
      return new Response('{"ok":true}', { status: 200 });
    });
    const wrapped = optimistic<{ id: number }>(act, {
      body: ({ id }) => `id=${id}`,
    });
    expect(wrapped.url).toBe('/act-1');
    const res = await wrapped.invoke({ id: 7 });
    expect(res.status).toBe(200);
    expect(sawBody).toBe('id=7');
  });

  it('runs apply synchronously — optimistic state visible before await resolves', async () => {
    let local = 'old';
    let respondCalled = false;
    // Defer the response to a microtask so we can observe state between
    // "apply ran" and "response resolved."
    const act = makeFakeAction('/act-2', async () => {
      respondCalled = true;
      return new Response('ok');
    });
    const wrapped = optimistic<{ next: string }>(act, {
      body: () => null,
      apply: ({ next }) => {
        local = next;
      },
    });
    const p = wrapped.invoke({ next: 'new' });
    // apply has already run — optimistic state visible immediately.
    expect(local).toBe('new');
    await p;
    expect(respondCalled).toBe(true);
  });

  it('invalidates listed queries on success (static array)', async () => {
    let calls = 0;
    const q = query({
      key: ['user', 1],
      fetcher: () => {
        calls++;
        return Promise.resolve({ id: 1, name: 'A' });
      },
    });
    await drain();
    expect(calls).toBe(1);
    expect(q()?.name).toBe('A');

    const act = makeFakeAction('/save', () => new Response('ok', { status: 200 }));
    const wrapped = optimistic<{ name: string }>(act, {
      body: ({ name }) => name,
      invalidates: [['user', 1]],
    });
    await wrapped.invoke({ name: 'B' });
    await drain();
    expect(calls).toBe(2);
  });

  it('invalidates with function form receiving args + response', async () => {
    let calls = 0;
    query({
      key: ['user', 2],
      fetcher: () => {
        calls++;
        return Promise.resolve(null);
      },
    });
    await drain();
    expect(calls).toBe(1);

    const act = makeFakeAction('/save', () => new Response('ok'));
    const wrapped = optimistic<{ id: number }>(act, {
      body: () => null,
      invalidates: (args, response) => {
        expect(response.ok).toBe(true);
        return [['user', args.id]];
      },
    });
    await wrapped.invoke({ id: 2 });
    await drain();
    expect(calls).toBe(2);
  });

  it('fires onSettle with response on success', async () => {
    const act = makeFakeAction('/s', () => new Response('ok', { status: 200 }));
    let captured: [unknown, Response | undefined, unknown] | null = null;
    const wrapped = optimistic<{ x: number }>(act, {
      body: () => null,
      onSettle: (args, res, err) => {
        captured = [args, res, err];
      },
    });
    await wrapped.invoke({ x: 1 });
    expect(captured).not.toBeNull();
    expect(captured![0]).toEqual({ x: 1 });
    expect(captured![1]?.status).toBe(200);
    expect(captured![2]).toBeUndefined();
  });
});

describe('optimistic — failure paths (ADR 0049)', () => {
  it('rolls back when response.ok is false (default isSuccess)', async () => {
    let local = 'before';
    const act = makeFakeAction('/fail', () => new Response('nope', { status: 500 }));
    let rollbackCalls = 0;
    const wrapped = optimistic<{ next: string }>(act, {
      body: () => null,
      apply: ({ next }) => {
        const prev = local;
        local = next;
        return () => {
          rollbackCalls++;
          local = prev;
        };
      },
    });
    const res = await wrapped.invoke({ next: 'after' });
    expect(res.status).toBe(500);
    expect(rollbackCalls).toBe(1);
    expect(local).toBe('before');
  });

  it('rolls back and re-throws when invoke rejects', async () => {
    let local = 'before';
    const networkErr = new Error('offline');
    const act = makeFakeAction('/reject', () => Promise.reject(networkErr));
    const wrapped = optimistic<{ next: string }>(act, {
      body: () => null,
      apply: ({ next }) => {
        const prev = local;
        local = next;
        return () => {
          local = prev;
        };
      },
    });
    await expect(wrapped.invoke({ next: 'after' })).rejects.toBe(networkErr);
    expect(local).toBe('before');
  });

  it('does not invalidate when response is failure', async () => {
    let calls = 0;
    query({
      key: 'no-invalidate-on-fail',
      fetcher: () => {
        calls++;
        return Promise.resolve(null);
      },
    });
    await drain();
    expect(calls).toBe(1);

    const act = makeFakeAction('/fail', () => new Response('', { status: 400 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      invalidates: ['no-invalidate-on-fail'],
    });
    await wrapped.invoke();
    await drain();
    expect(calls).toBe(1); // unchanged — invalidate only on success
  });

  it('fires onSettle with (undefined response, error) on reject', async () => {
    const networkErr = new Error('boom');
    const act = makeFakeAction('/reject', () => Promise.reject(networkErr));
    let captured: [unknown, Response | undefined, unknown] | null = null;
    const wrapped = optimistic<void>(act, {
      body: () => null,
      onSettle: (args, res, err) => {
        captured = [args, res, err];
      },
    });
    await expect(wrapped.invoke()).rejects.toBe(networkErr);
    expect(captured![1]).toBeUndefined();
    expect(captured![2]).toBe(networkErr);
  });

  it('does not throw when rollback itself throws (logs instead)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const act = makeFakeAction('/fail', () => new Response('', { status: 500 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      apply: () => () => {
        throw new Error('rollback exploded');
      },
    });
    await expect(wrapped.invoke()).resolves.toBeInstanceOf(Response);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('optimistic — isSuccess override (ADR 0049)', () => {
  it('treats response as success when custom isSuccess returns true', async () => {
    let calls = 0;
    query({
      key: 'custom-ok',
      fetcher: () => {
        calls++;
        return Promise.resolve(null);
      },
    });
    await drain();
    expect(calls).toBe(1);

    // 422 normally = failure; with custom isSuccess we accept anything < 500.
    const act = makeFakeAction('/maybe-ok', () => new Response('', { status: 422 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      invalidates: ['custom-ok'],
      isSuccess: (r) => r.status < 500,
    });
    await wrapped.invoke();
    await drain();
    expect(calls).toBe(2); // invalidate fired because we said 422 is success
  });
});

describe('optimistic — options shape (ADR 0049)', () => {
  it('init function form receives args', async () => {
    let sawInit: RequestInit | undefined;
    const act = serverAction('/with-init', async () => new Response('ok'));
    (act as { invoke: (body?: BodyInit | null, init?: RequestInit) => Promise<Response> }).invoke =
      async (_body, init) => {
        sawInit = init;
        return new Response('ok');
      };
    const wrapped = optimistic<{ token: string }>(act, {
      body: () => null,
      init: ({ token }) => ({ headers: { Authorization: `Bearer ${token}` } }),
    });
    await wrapped.invoke({ token: 'abc' });
    expect((sawInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer abc',
    );
  });

  it('works with neither apply nor invalidates (pure passthrough)', async () => {
    const act = makeFakeAction('/bare', () => new Response('ok', { status: 200 }));
    const wrapped = optimistic<void>(act, { body: () => null });
    const res = await wrapped.invoke();
    expect(res.status).toBe(200);
  });

  it('apply returning void (no rollback) does not throw on failure', async () => {
    const act = makeFakeAction('/fail', () => new Response('', { status: 500 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      apply: () => {
        // returns void — no rollback
      },
    });
    await expect(wrapped.invoke()).resolves.toBeInstanceOf(Response);
  });

  it('does NOT apply optimistic state when body() throws (no dirty UI strand)', async () => {
    let applied = false;
    let requested = false;
    const act = makeFakeAction('/never', () => {
      requested = true;
      return new Response('ok');
    });
    const wrapped = optimistic<{ x: number }>(act, {
      body: () => {
        throw new Error('cannot serialize');
      },
      apply: () => {
        applied = true;
        return () => {};
      },
    });
    await expect(wrapped.invoke({ x: 1 })).rejects.toThrow('cannot serialize');
    // body threw before apply ran → no optimistic mutation, no request.
    expect(applied).toBe(false);
    expect(requested).toBe(false);
  });

  it('does NOT apply optimistic state when init() throws', async () => {
    let applied = false;
    const act = makeFakeAction('/never', () => new Response('ok'));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      init: () => {
        throw new Error('bad init');
      },
      apply: () => {
        applied = true;
      },
    });
    await expect(wrapped.invoke()).rejects.toThrow('bad init');
    expect(applied).toBe(false);
  });
});

describe('optimistic — user-hook throw isolation (audit Bug D)', () => {
  it('invalidates() throwing on success does NOT trigger rollback', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rollbackCalls = 0;
    const act = makeFakeAction('/ok', () => new Response('', { status: 200 }));
    const wrapped = optimistic<{ id: number }>(act, {
      body: () => null,
      apply: () => () => {
        rollbackCalls++;
      },
      invalidates: () => {
        throw new Error('invalidates blew up');
      },
    });
    // The action succeeded — invalidates throwing must NOT propagate, and
    // must NOT roll back the optimistic state. The wrapper logs and returns
    // the response.
    const res = await wrapped.invoke({ id: 1 });
    expect(res.status).toBe(200);
    expect(rollbackCalls).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      '[purity] optimistic invalidates threw:',
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it('onSettle() throwing on success does NOT trigger rollback', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rollbackCalls = 0;
    const act = makeFakeAction('/ok', () => new Response('', { status: 200 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      apply: () => () => {
        rollbackCalls++;
      },
      onSettle: () => {
        throw new Error('onSettle exploded');
      },
    });
    const res = await wrapped.invoke();
    expect(res.status).toBe(200);
    expect(rollbackCalls).toBe(0);
    expect(errSpy).toHaveBeenCalledWith('[purity] optimistic onSettle threw:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('onSettle() throwing on failure path does NOT swallow the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const networkErr = new Error('network down');
    const act = makeFakeAction('/reject', () => Promise.reject(networkErr));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      onSettle: () => {
        throw new Error('onSettle exploded');
      },
    });
    // The original network error must propagate; the user's broken onSettle
    // is logged and discarded.
    await expect(wrapped.invoke()).rejects.toBe(networkErr);
    expect(errSpy).toHaveBeenCalledWith('[purity] optimistic onSettle threw:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('a successful response is returned even when invalidates AND onSettle throw', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const act = makeFakeAction('/ok', () => new Response('body', { status: 200 }));
    const wrapped = optimistic<void>(act, {
      body: () => null,
      invalidates: () => {
        throw new Error('inv');
      },
      onSettle: () => {
        throw new Error('settle');
      },
    });
    const res = await wrapped.invoke();
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });
});
