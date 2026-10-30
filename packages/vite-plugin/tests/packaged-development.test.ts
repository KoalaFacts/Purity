import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vite-plus/test';

const repo = resolve(import.meta.dirname, '../../..');
const packages = ['signals', 'compiler', 'core', 'ssr', 'router', 'platform', 'vite-plugin'];

describe('packed development conditions', () => {
  it('loads the published packages in Node without transforming node_modules TypeScript', async () => {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run this test through npm');
    const directory = mkdtempSync(join(repo, '.packaged-development-'));
    if (dirname(directory) !== repo || !basename(directory).startsWith('.packaged-development-')) {
      throw new Error('Unexpected temporary test directory');
    }
    try {
      const output = execFileSync(
        process.execPath,
        [
          npm,
          'pack',
          '--json',
          '--pack-destination',
          directory,
          ...packages.flatMap((name) => ['-w', `@purityjs/${name}`]),
        ],
        { cwd: repo, encoding: 'utf8' },
      );
      const result = JSON.parse(output) as
        | Array<{ name: string; filename: string }>
        | Record<string, { filename: string }>;
      for (const name of packages) {
        const packed = Array.isArray(result)
          ? result.find((entry) => entry.name === `@purityjs/${name}`)
          : result[`@purityjs/${name}`];
        expect(packed?.filename).toBeTruthy();
        const target = join(directory, 'node_modules', '@purityjs', name);
        mkdirSync(target, { recursive: true });
        execFileSync('tar', [
          '-xzf',
          join(directory, packed!.filename),
          '-C',
          target,
          '--strip-components',
          '1',
        ]);
      }

      const specifiers = [
        '@purityjs/signals',
        '@purityjs/compiler',
        '@purityjs/core',
        '@purityjs/core/jit',
        '@purityjs/core/jit-client',
        '@purityjs/core/runtime',
        '@purityjs/core/list-runtime',
        '@purityjs/core/forms',
        '@purityjs/core/csr-runtime',
        '@purityjs/core/ssr-bridge',
        '@purityjs/core/csr',
        '@purityjs/core/virtual',
        '@purityjs/core/hydration-bridge',
        '@purityjs/ssr',
        '@purityjs/ssr/runtime',
        '@purityjs/router',
        '@purityjs/platform/actions',
        '@purityjs/platform/signals',
        '@purityjs/platform/query',
        '@purityjs/platform/islands',
        '@purityjs/vite-plugin',
      ];
      for (const conditions of [[], ['--conditions=purity-server', '--conditions=browser']]) {
        // The Vite plugin is a Node build tool; setting a global browser
        // condition would also switch its third-party parser to its WASM build.
        const entries = conditions.length
          ? specifiers.filter((name) => name !== '@purityjs/vite-plugin')
          : specifiers;
        const exercise = `
          const value = signals.state(0), seen = [];
          const stop = core.watch(() => { seen.push(value()); });
          value(1); await Promise.resolve(); stop();
          if (seen.join(',') !== '0,1') throw new Error('reactive graphs differ');
          const html = await ssr.renderToString(() => core.when(() => true, () => 'development'));
          if (!html.includes('development')) throw new Error('SSR bridge not shared');
          if (!globalThis.__purity_inspect__) throw new Error('development inspector missing');
        `;
        const scripts = [
          `for (const specifier of JSON.parse(process.argv[1])) await import(specifier);
           const signals = await import('@purityjs/signals'), core = await import('@purityjs/core'), ssr = await import('@purityjs/ssr'); ${exercise}`,
          `(async () => { for (const specifier of JSON.parse(process.argv[1])) require(specifier);
           const signals = require('@purityjs/signals'), core = require('@purityjs/core'), ssr = require('@purityjs/ssr'); ${exercise} })();`,
        ];
        for (const script of scripts) {
          execFileSync(
            process.execPath,
            [
              '--conditions=development',
              ...conditions,
              ...(script.includes('await import') ? ['--input-type=module'] : []),
              '-e',
              script,
              JSON.stringify(entries),
            ],
            { cwd: directory, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
          );
        }
      }

      // Node production normally sets NODE_ENV without adding export conditions.
      // Both module systems must select an inspector-free signals artifact.
      for (const conditions of [[], ['--conditions=purity-server']]) {
        for (const load of ["await import('@purityjs/signals')", "require('@purityjs/signals')"]) {
          const script = `
          const { state } = ${load};
          if (state(7)() !== 7) throw new Error('signal failed');
          if (globalThis.__purity_inspect__) throw new Error('inspector present in production');
        `;
          execFileSync(
            process.execPath,
            [
              ...conditions,
              ...(load.startsWith('await') ? ['--input-type=module'] : []),
              '-e',
              script,
            ],
            { cwd: directory, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' },
          );
        }
      }

      // Browser Vite development still transforms the source entry points.
      const entry = join(directory, 'client.ts');
      writeFileSync(entry, "export { mount, state } from '@purityjs/core';\n");
      const clientOutput = await build({
        root: directory,
        configFile: false,
        logLevel: 'silent',
        mode: 'development',
        resolve: { conditions: ['browser', 'development'] },
        build: { lib: { entry, formats: ['es'] }, write: false, minify: false },
      });
      const built = Array.isArray(clientOutput) ? clientOutput[0] : clientOutput;
      const modules = built.output
        .filter((chunk) => chunk.type === 'chunk')
        .flatMap((chunk) => Object.keys(chunk.modules))
        .map((path) => path.replaceAll('\\', '/'));
      expect(modules.some((path) => path.includes('/@purityjs/core/src/component.ts'))).toBe(true);
      expect(modules.some((path) => path.includes('/@purityjs/signals/src/signals.ts'))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
