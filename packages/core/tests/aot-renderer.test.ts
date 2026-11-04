// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { mount } from '../src/component.ts';
import {
  flattenValue as csrFlattenValue,
  swapSlot as csrSwapSlot,
} from '../src/runtime/csr-runtime.ts';
import {
  flattenValue as runtimeFlattenValue,
  swapSlot as runtimeSwapSlot,
} from '../src/compiler/runtime.ts';
import {
  renderCompiledTemplate,
  renderCompiledTemplateAot,
} from '../src/runtime/hydrate-runtime.ts';

describe('compiled template renderers', () => {
  it('shares slot helpers across CSR and hydratable runtime entries', () => {
    expect(runtimeFlattenValue).toBe(csrFlattenValue);
    expect(runtimeSwapSlot).toBe(csrSwapSlot);
  });

  it('keeps the general renderer compatible with explicit-source watch', async () => {
    const value = state(0);
    const changes: number[][] = [];
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        renderCompiledTemplate(
          (_, watcher) => {
            watcher(value, (next, previous) => {
              changes.push([previous, next]);
              return undefined;
            });
            return document.createElement('p');
          },
          (_, __, root) => root,
          [],
        ),
      host,
    );
    value(1);
    await Promise.resolve();
    expect(changes).toEqual([[0, 1]]);
    mounted.unmount();
    value(2);
    await Promise.resolve();
    expect(changes).toEqual([[0, 1]]);
  });

  it('runs and disposes generated single-callback effects under their owner', async () => {
    const value = state(0);
    const host = document.createElement('div');
    let reads = 0;
    const mounted = mount(
      () =>
        renderCompiledTemplateAot(
          (_, effect) => {
            const node = document.createElement('p');
            effect(() => {
              reads++;
              node.textContent = String(value());
              return undefined;
            });
            return node;
          },
          (_, __, root) => root,
          [],
        ),
      host,
    );
    expect(host.textContent).toBe('0');
    value(1);
    await Promise.resolve();
    expect(host.textContent).toBe('1');
    mounted.unmount();
    const before = reads;
    value(2);
    await Promise.resolve();
    expect(reads).toBe(before);
  });
});
