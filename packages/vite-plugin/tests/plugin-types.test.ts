import { defineConfig, type Plugin } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

// CQ-09d: the plugin's tests are type-checked in CI. `purity()`'s object is
// checked with `satisfies Plugin` against Vite's own type (it was an unchecked
// literal), and its concrete hook types stay visible to callers.
describe('purity() plugin type', () => {
  it('is a Vite Plugin usable in defineConfig', () => {
    const plugin: Plugin = purity();
    const config = defineConfig({ plugins: [plugin, purity({ strictAot: false })] });
    expect(plugin.name).toBe('purity');
    expect(plugin.enforce).toBe('pre');
    expect(config.plugins).toHaveLength(2);
  });
});
