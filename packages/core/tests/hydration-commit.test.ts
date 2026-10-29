// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { onDestroy, onDispose, onError, onMount } from '../src/component.ts';
import { FAILED_HYDRATION, hydrate } from '../src/hydrate.ts';
import {
  clearHydrationCache,
  consumeHydrationValue,
  primeHydrationCache,
} from '../src/ssr/hydration-cache.ts';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.replaceChildren();
  clearHydrationCache();
});
function fixture() {
  const host = document.createElement('main');
  const p = document.createElement('p');
  p.textContent = 'server';
  const script = document.createElement('script');
  script.type = 'application/json';
  script.id = '__purity_resources__';
  script.textContent = JSON.stringify({ ordered: [], keyed: { value: 'server-value' } });
  host.append(p, script);
  document.body.append(host);
  return { host, p, script };
}

describe('resource hydration prepares before it commits', () => {
  it('distinguishes handled empty-root failure from a successful empty render', async () => {
    const host = document.createElement('main');
    document.body.append(host);
    let disposed = 0;
    const failed = hydrate(host, () => {
      onError(() => {});
      onDispose(() => disposed++);
      throw new Error('handled empty render failure');
    });
    expect(failed).toBe(FAILED_HYDRATION);
    expect(disposed).toBe(1);

    let mounted = 0;
    const successful = hydrate(host, () => {
      onMount(() => mounted++);
      return document.createDocumentFragment();
    });
    expect(successful).not.toBe(FAILED_HYDRATION);
    disposers.push(successful.unmount);
    await Promise.resolve();
    expect(mounted).toBe(1);
  });

  it('keeps the source script connected during rendering and consumes it only on success', () => {
    const { host, p, script } = fixture();
    let wasConnected = false;
    let prepared: unknown;
    const result = hydrate(host, () => {
      wasConnected = script.parentNode === host;
      prepared = consumeHydrationValue('value');
      return p;
    });
    disposers.push(result.unmount);
    expect(wasConnected).toBe(true);
    expect(prepared).toBe('server-value');
    expect(script.parentNode).toBeNull();
    expect(host.firstChild).toBe(p);
  });

  it('rejects a detached root without any remove-and-reinsert mutation of SSR scripts', () => {
    const { host, p, script } = fixture();
    primeHydrationCache({ keyed: { value: 'prior' } });
    const observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true });
    let disposed = 0;
    expect(() =>
      hydrate(host, () => {
        onDispose(() => disposed++);
        return document.createElement('div');
      }),
    ).toThrow(/hydratable/);
    const scriptMutations = observer
      .takeRecords()
      .filter(
        (record) =>
          Array.from(record.removedNodes).includes(script) ||
          Array.from(record.addedNodes).includes(script),
      );
    observer.disconnect();
    expect(scriptMutations).toHaveLength(0);
    expect(host.firstChild).toBe(p);
    expect(p.nextSibling).toBe(script);
    expect(disposed).toBe(1);
    expect(consumeHydrationValue('value')).toBe('prior');
  });

  it('does not commit scripts before a custom-element adoption hook succeeds', () => {
    const { host, p, script } = fixture();
    let preparedWithScript = false;
    const element = p as HTMLElement & { _hydrateSSR?: () => void };
    element._hydrateSSR = () => {
      preparedWithScript = script.parentNode === host;
      throw new Error('adoption failed');
    };
    expect(() => hydrate(host, () => p)).toThrow('adoption failed');
    expect(preparedWithScript).toBe(true);
    expect(script.parentNode).toBe(host);
    expect(host.firstChild).toBe(p);
    delete element._hydrateSSR;
    disposers.push(hydrate(host, () => p).unmount);
    expect(script.parentNode).toBeNull();
    expect(consumeHydrationValue('value')).toBe('server-value');
  });

  it('does not fire onDestroy for a deferred render abandoned before SSR adoption', () => {
    const { host } = fixture();
    let attempts = 0;
    let destroyed = 0;
    let disposed = 0;
    const mounted = hydrate(host, () => {
      onDestroy(() => destroyed++);
      onDispose(() => disposed++);
      if (++attempts === 1) {
        return {
          __purity_deferred__: true,
          values: [],
          hydrate: () => {
            throw new Error('deliberate hydration walker mismatch');
          },
        } as unknown as DocumentFragment;
      }
      const fresh = document.createElement('p');
      fresh.textContent = 'fresh';
      return fresh;
    });
    expect(attempts).toBe(2);
    expect(disposed).toBe(1);
    expect(destroyed).toBe(0);
    expect(host.textContent).toBe('fresh');
    mounted.unmount();
    expect(disposed).toBe(2);
    expect(destroyed).toBe(1);
  });
});
