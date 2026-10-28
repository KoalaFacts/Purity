// @vitest-environment jsdom
import { afterEach, expect, it } from 'vite-plus/test';
import { hydrate } from '../src/hydrate.ts';
import { clearHydrationCache, consumeHydrationValue } from '../src/ssr/hydration-cache.ts';

afterEach(() => {
  clearHydrationCache();
  document.body.replaceChildren();
});

function fixture(shell: string, boundary: string) {
  const root = document.createElement('section');
  const view = document.createElement('p');
  view.textContent = 'server';
  const shellScript = document.createElement('script');
  shellScript.id = '__purity_resources__';
  shellScript.type = 'application/json';
  shellScript.textContent = shell;
  const chunk = document.createElement('script');
  chunk.id = '__purity_resources_chunk_0';
  chunk.type = 'application/json';
  chunk.textContent = boundary;
  root.append(view, shellScript);
  document.body.append(root, chunk);
  return { root, view, shellScript, chunk };
}

it('preserves legacy ordered shell resources while merging adjacent keyed chunks', () => {
  const { root, view, shellScript, chunk } = fixture('[7,8]', '{"keyed":{"later":"stream"}}');
  const mounted = hydrate(root, () => view);
  expect(consumeHydrationValue()).toBe(7);
  expect(consumeHydrationValue()).toBe(8);
  expect(consumeHydrationValue('later')).toBe('stream');
  expect(shellScript.isConnected).toBe(false);
  expect(chunk.isConnected).toBe(false);
  mounted.unmount();
});

it('keeps null-prototype special keys and streaming-over-shell precedence', () => {
  const { root, view } = fixture(
    '{"ordered":[],"keyed":{"__proto__":"shell","shared":"shell"}}',
    '{"keyed":{"__proto__":"stream","shared":"stream","later":"stream"}}',
  );
  const mounted = hydrate(root, () => view);
  expect(consumeHydrationValue('__proto__')).toBe('stream');
  expect(consumeHydrationValue('shared')).toBe('stream');
  expect(consumeHydrationValue('later')).toBe('stream');
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  mounted.unmount();
});

it('uses valid streamed keyed values when shell JSON is unusable', () => {
  const { root, view } = fixture('123', '{"keyed":{"later":"from-stream"}}');
  const mounted = hydrate(root, () => view);
  expect(consumeHydrationValue('later')).toBe('from-stream');
  expect(consumeHydrationValue()).toBeUndefined();
  mounted.unmount();
});
