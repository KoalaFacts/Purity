// @vitest-environment jsdom
// ADR 0042 — permissionSignal tests.
// jsdom doesn't ship navigator.permissions; we install a controllable mock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { permissionSignal } from '../src/index.ts';
import { _resetPermissionSignalCache } from '../src/permission-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

type MockStatus = {
  state: PermissionState;
  listeners: (() => void)[];
  addEventListener(t: 'change', cb: () => void): void;
  removeEventListener(t: 'change', cb: () => void): void;
  setState(s: PermissionState): void;
};

const statuses = new Map<string, MockStatus>();
let originalPermissions: Permissions | undefined;
let rejectNextQuery = false;

function installPermissionsMock(): void {
  originalPermissions = navigator.permissions;
  const mock = {
    query: vi.fn(async (descriptor: { name: string }) => {
      if (rejectNextQuery) {
        rejectNextQuery = false;
        throw new TypeError('invalid permission');
      }
      let s = statuses.get(descriptor.name);
      if (!s) {
        s = {
          state: 'prompt',
          listeners: [],
          addEventListener(_t, cb) {
            this.listeners.push(cb);
          },
          removeEventListener(_t, cb) {
            this.listeners = this.listeners.filter((x) => x !== cb);
          },
          setState(next) {
            this.state = next;
            for (const l of this.listeners) l();
          },
        };
        statuses.set(descriptor.name, s);
      }
      return s as unknown as PermissionStatus;
    }),
  };
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: mock });
}

function uninstallPermissionsMock(): void {
  if (originalPermissions === undefined) {
    delete (navigator as unknown as { permissions?: unknown }).permissions;
  } else {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: originalPermissions,
    });
  }
  statuses.clear();
  rejectNextQuery = false;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetPermissionSignalCache();
  installPermissionsMock();
});

afterEach(() => {
  uninstallPermissionsMock();
  _resetPermissionSignalCache();
});

describe('permissionSignal (ADR 0042)', () => {
  it('returns a constant `prompt` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(permissionSignal('camera')()).toBe('prompt');
    } finally {
      popSSRRenderContext();
    }
  });

  it('starts at `prompt` then resolves to the queried state', async () => {
    statuses.set('camera', {
      state: 'granted',
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener() {},
      setState(s) {
        this.state = s;
      },
    });
    const s = permissionSignal('camera');
    expect(s()).toBe('prompt');
    await flush();
    expect(s()).toBe('granted');
  });

  it('updates on change events', async () => {
    const s = permissionSignal('camera');
    await flush();
    expect(s()).toBe('prompt');
    statuses.get('camera')!.setState('granted');
    expect(s()).toBe('granted');
    statuses.get('camera')!.setState('denied');
    expect(s()).toBe('denied');
  });

  it('caches per name', () => {
    const a = permissionSignal('camera');
    const b = permissionSignal('camera');
    expect(a).toBe(b);
  });

  it('logs and stays at `prompt` when query rejects', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rejectNextQuery = true;
    const s = permissionSignal('bogus');
    await flush();
    expect(s()).toBe('prompt');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('does not cache a rejected query — a later call retries', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rejectNextQuery = true;
    const first = permissionSignal('flaky');
    await flush();
    expect(first()).toBe('prompt');
    // Second call should re-query (rejectNextQuery already consumed and
    // reset to false), and the resolved status should flow through.
    statuses.set('flaky', {
      state: 'granted',
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener() {},
      setState(s) {
        this.state = s;
      },
    });
    const second = permissionSignal('flaky');
    await flush();
    expect(second()).toBe('granted');
    errSpy.mockRestore();
  });

  it('returns `prompt` when navigator.permissions is unavailable', () => {
    uninstallPermissionsMock();
    const s = permissionSignal('camera');
    expect(s()).toBe('prompt');
    installPermissionsMock();
  });

  it('_resetPermissionSignalCache detaches the PermissionStatus change listener', async () => {
    permissionSignal('camera');
    await flush();
    const status = statuses.get('camera')!;
    expect(status.listeners.length).toBe(1);

    _resetPermissionSignalCache();
    expect(status.listeners.length).toBe(0);
  });

  it('_resetPermissionSignalCache racing an in-flight query never attaches a listener', async () => {
    permissionSignal('camera'); // begins the async query
    _resetPermissionSignalCache(); // reset BEFORE the query resolves
    await flush();
    const status = statuses.get('camera');
    // The query did resolve into the mock, but the abort flag prevented
    // the addEventListener call.
    expect(status?.listeners.length ?? 0).toBe(0);
  });

  it('a STALE in-flight query resolving after reset+re-create does not attach an extra listener', async () => {
    // Set up status A for first query.
    const statusA: MockStatus = {
      state: 'prompt',
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener(_t, cb) {
        this.listeners = this.listeners.filter((x) => x !== cb);
      },
      setState(next) {
        this.state = next;
        for (const l of this.listeners) l();
      },
    };
    statuses.set('camera', statusA);

    // Begin query A — promise resolves to statusA but stays pending.
    permissionSignal('camera');

    // Reset (clears cache + bumps generation). Then re-create under a
    // fresh statusB.
    _resetPermissionSignalCache();
    const statusB: MockStatus = {
      state: 'granted',
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener(_t, cb) {
        this.listeners = this.listeners.filter((x) => x !== cb);
      },
      setState(next) {
        this.state = next;
        for (const l of this.listeners) l();
      },
    };
    statuses.set('camera', statusB);
    const s = permissionSignal('camera'); // begins query B
    await flush();
    await flush();

    // Query B's listener should be attached to statusB; statusA must
    // NOT have a listener attached by the stale query A.
    expect(statusA.listeners.length).toBe(0);
    expect(statusB.listeners.length).toBe(1);
    expect(s()).toBe('granted');
  });

  it('a synchronous throw from navigator.permissions.query is caught and the cache is evicted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Replace .query with a function that throws synchronously (e.g.
    // legacy WebKit on an unknown PermissionName).
    const throwingQuery = vi.fn(() => {
      throw new TypeError('illegal invocation');
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: throwingQuery },
    });

    // Must not throw out of permissionSignal.
    expect(() => permissionSignal('camera')).not.toThrow();
    expect(errSpy).toHaveBeenCalled();

    // Cache was evicted: restore the working mock and verify a later
    // call goes through the real resolution path.
    installPermissionsMock();
    statuses.set('camera', {
      state: 'granted',
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener() {},
      setState(s) {
        this.state = s;
      },
    });
    const s = permissionSignal('camera');
    await flush();
    expect(s()).toBe('granted');
    errSpy.mockRestore();
  });
});
