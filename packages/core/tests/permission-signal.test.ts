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
});
