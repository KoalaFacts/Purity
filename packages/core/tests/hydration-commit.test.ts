// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { onDispose } from '../src/component.ts';
import { hydrate } from '../src/hydrate.ts';
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
});
