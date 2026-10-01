// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { devtoolsClientSource, startPurityDevtools } from '../src/devtools-client.ts';
import { purity } from '../src/index.ts';

describe('development graph panel', () => {
  let dispose: (() => void) | undefined;
  const state = {
    kind: 'state',
    version: 3,
    value: 'hello',
    sources: [] as unknown[],
    observers: [] as unknown[],
  };
  const computed = {
    kind: 'computed',
    status: 'clean',
    version: 2,
    value: 42,
    sources: [state],
    observers: [],
  };
  const nodes = vi.fn(() => [state, computed]);
  function open() {
    dispose = startPurityDevtools();
    const root = document.getElementById('purity-devtools')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.trigger')!.click();
    return root;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    state.observers = [computed];
    nodes.mockReset().mockReturnValue([state, computed]);
    vi.stubGlobal('__purity_inspect__', { version: 1, nodes });
  });
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the cyclic snapshot only on open and shows connections as text', () => {
    dispose = startPurityDevtools();
    expect(nodes).not.toHaveBeenCalled();
    expect(startPurityDevtools()).toBeUndefined();
    const root = document.getElementById('purity-devtools')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.trigger')!.click();
    expect(root.querySelector('.summary')!.textContent).toBe('2 nodes · 2 shown');
    root.querySelectorAll<HTMLButtonElement>('.row')[1].click();
    expect(root.activeElement).toBe(root.querySelectorAll('.row')[1]);
    expect(root.querySelector('.detail')!.textContent).toBe(
      'Node #2 · version 2\nSources: #1\nObservers: none',
    );
    expect(root.querySelector('.row')!.getAttribute('data-detail')).toContain('Observers: #2');
  });

  it('filters, refreshes, and escapes back to the trigger without polling while closed', () => {
    const root = open();
    const search = root.querySelector<HTMLInputElement>('input')!;
    search.value = 'CLEAN';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.row')).toHaveLength(1);
    nodes.mockReturnValue([]);
    root.querySelector<HTMLButtonElement>('header button')!.click();
    expect(root.querySelector('.summary')!.textContent).toBe('0 nodes · 0 shown');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    search.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    search.dispatchEvent(new Event('input')); // WebKit's native search cancellation must not re-render a closed panel.
    expect(root.querySelectorAll('.row')).toHaveLength(0);
    expect(root.querySelector('.summary')!.textContent).toBe('');
    expect(root.activeElement).toBe(root.querySelector('.trigger'));
    expect(root.querySelector('.trigger')!.getAttribute('aria-expanded')).toBe('false');
    const calls = nodes.mock.calls.length;
    vi.advanceTimersByTime(3000);
    expect(nodes).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes every second, but preserves keyboard focus on a node', () => {
    const root = open();
    vi.advanceTimersByTime(1000);
    expect(nodes).toHaveBeenCalledTimes(2);
    const row = root.querySelector<HTMLButtonElement>('.row')!;
    row.focus();
    row.click();
    vi.advanceTimersByTime(2000);
    expect(nodes).toHaveBeenCalledTimes(2);
    expect(root.activeElement).toBe(row);
    root.querySelector<HTMLInputElement>('input')!.focus();
    vi.advanceTimersByTime(1000);
    expect(nodes).toHaveBeenCalledTimes(3);
    expect(root.querySelector('.detail')!.textContent).toBe(
      'Select a node to see its connections.',
    );
  });

  it('releases polling and rows if the host is removed', async () => {
    const root = open();
    document.getElementById('purity-devtools')!.remove();
    await Promise.resolve(); // MutationObserver delivery
    expect(vi.getTimerCount()).toBe(0);
    expect(root.querySelectorAll('.row')).toHaveLength(0);
    vi.advanceTimersByTime(3000);
    expect(nodes).toHaveBeenCalledTimes(1);
  });

  it('also disposes if the entire document body is replaced', async () => {
    const root = open();
    document.body.replaceWith(document.createElement('body'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(root.querySelectorAll('.row')).toHaveLength(0);
  });

  it('limits rows and renders untrusted values as text without inspecting objects', () => {
    const values = Array.from({ length: 201 }, () => ({
      ...state,
      value: '<img src=x onerror=alert(1)>',
    }));
    nodes.mockReturnValue(values);
    const root = open();
    expect(root.querySelectorAll('.row')).toHaveLength(200);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('p')!.textContent).toContain('first 200');
    nodes.mockReturnValue([
      {
        ...state,
        value: {
          toString() {
            throw new Error('do not call');
          },
        },
      } as any,
    ]);
    root.querySelector<HTMLButtonElement>('header button')!.click();
    expect(root.querySelector('.row')!.textContent).toContain('Object');
  });

  it('clears stale rows on errors and recovers from a replaced inspector hook', () => {
    const root = open();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    nodes.mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.advanceTimersByTime(1000);
    expect(root.querySelectorAll('.row')).toHaveLength(0);
    expect(root.querySelector('.summary')!.textContent).toContain('Unable');
    expect(log).toHaveBeenCalledOnce();
    vi.stubGlobal('__purity_inspect__', { version: 1, nodes: () => [state] });
    vi.advanceTimersByTime(1000);
    expect(root.querySelectorAll('.row')).toHaveLength(1);
    vi.stubGlobal('__purity_inspect__', { version: 2, nodes });
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.summary')!.textContent).toBe('Reactive inspector unavailable.');
    expect(root.querySelectorAll('.row')).toHaveLength(0);
  });

  it.each([undefined, { version: 2, nodes }])(
    'does not mount with an incompatible hook: %s',
    (hook) => {
      vi.stubGlobal('__purity_inspect__', hook);
      expect(startPurityDevtools()).toBeUndefined();
      expect(document.getElementById('purity-devtools')).toBeNull();
    },
  );

  it('serves standalone JavaScript and disposes on HMR, including before load', () => {
    let cleanup: (() => void) | undefined;
    const hot = {
      accept: vi.fn(),
      dispose: (fn: () => void) => {
        cleanup = fn;
      },
    };
    const run = new Function('hot', devtoolsClientSource.replaceAll('import.meta.hot', 'hot'));
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    run(hot);
    cleanup!();
    window.dispatchEvent(new Event('load'));
    expect(document.getElementById('purity-devtools')).toBeNull();
    run(hot);
    window.dispatchEvent(new Event('load'));
    const root = document.getElementById('purity-devtools')!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.trigger')!.click();
    cleanup!();
    expect(hot.accept).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.getElementById('purity-devtools')).toBeNull();
    expect(root.querySelectorAll('.row')).toHaveLength(0);
  });
});

describe('DevTools Vite integration', () => {
  it.each([{}, { devtools: false }])('is opt-in: %s', (options) => {
    const plugin = purity(options);
    plugin.configResolved({ root: process.cwd(), command: 'serve' });
    expect(plugin.transformIndexHtml('<html></html>')).toBe('<html></html>');
    expect(plugin.resolveId('virtual:purity-devtools')).toBeNull();
    expect(plugin.load('\0virtual:purity-devtools')).toBeNull();
  });

  it.each(['/', '/Purity/', 'https://cdn.example.test/Purity/'])(
    'uses the resolved base %s',
    (base) => {
      const plugin = purity({ devtools: true });
      plugin.configResolved({ root: process.cwd(), command: 'serve', base });
      const path = base === '/' ? '/' : '/Purity/';
      expect(plugin.transformIndexHtml('<html></html>')).toMatchObject({
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module', src: `${path}@id/__x00__virtual:purity-devtools` },
            injectTo: 'body',
          },
        ],
      });
      expect(plugin.resolveId('virtual:purity-devtools')).toBe('\0virtual:purity-devtools');
      expect(plugin.load('\0virtual:purity-devtools')).toBe(devtoolsClientSource);
    },
  );

  it.each([{ command: 'build' }, { command: 'serve', isPreview: true }])(
    'excludes DevTools from %s',
    (config) => {
      const plugin = purity({ devtools: true });
      plugin.config({}, { isPreview: config.isPreview });
      plugin.configResolved({ root: process.cwd(), ...config });
      expect(plugin.transformIndexHtml('<html></html>')).toBe('<html></html>');
      expect(plugin.resolveId('virtual:purity-devtools')).toBeNull();
      expect(plugin.load('\0virtual:purity-devtools')).toBeNull();
    },
  );
});
