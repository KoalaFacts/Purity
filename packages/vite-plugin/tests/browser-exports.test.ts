import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vite-plus/test';

const core = resolve(import.meta.dirname, '../../core');
const manifest = JSON.parse(readFileSync(resolve(core, 'package.json'), 'utf8'));

describe('core browser entry points', () => {
  it('selects a browser build for both the default and CSR entries', () => {
    for (const entry of ['.', './csr', './virtual']) {
      expect(manifest.exports[entry].browser.import).toMatch(/^\.\/dist\/browser\//);
      expect(manifest.exports[entry].browser.require).toMatch(/^\.\/dist\/browser\//);
    }
  });

  it('excludes hydration walkers and SSR state from a complete CSR browser bundle', async () => {
    const dir = mkdtempSync(join(core, '.csr-bundle-test-'));
    try {
      const entry = join(dir, 'entry.js');
      writeFileSync(entry, "import * as core from '@purityjs/core/csr'; globalThis.core = core;");
      const built = await build({
        configFile: false,
        logLevel: 'silent',
        define: { __SSR__: 'false' },
        resolve: { alias: { '@purityjs/core/csr': resolve(core, 'src/csr.ts') } },
        build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
      });
      const result = Array.isArray(built) ? built[0] : built;
      const code = result.output
        .filter((part) => part.type === 'chunk')
        .map((part) => part.code)
        .join('\n');
      expect(code).not.toContain('__purity_deferred__');
      expect(code).not.toContain('ssrControls');
      expect(code).not.toContain('resolvedDataByKey');
      expect(code.includes('data-purity-window-spacer')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
