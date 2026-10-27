import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

it.each(['client', 'ssr', 'app'] as const)(
  'scaffolds the correct AOT capability for %s',
  (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'purity-build-mode-'));
    try {
      execFileSync(
        process.execPath,
        [
          resolve(import.meta.dirname, '../src/index.ts'),
          'project',
          ...(mode === 'client' ? [] : ['--' + mode]),
        ],
        { cwd: dir },
      );
      const config = readFileSync(join(dir, 'project/vite.config.ts'), 'utf8');
      if (mode === 'client') {
        expect(config).toContain('plugins: [purity()]');
        expect(config).not.toContain('hydratable: true');
      } else {
        expect(config).toContain('hydratable: true');
        expect(config).not.toContain('strictAot: false');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
