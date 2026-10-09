// Pins the exact scaffold output (package.json scripts/dependencies,
// vite.config.ts, tsconfig.json) for each of the three project modes
// (default client-only, --ssr, --app) BEFORE any attempt to de-duplicate
// the branching in src/index.ts that generates them. These files are
// user-visible artifacts shipped in every scaffolded project — a
// refactor that silently changes a script command or a tsconfig field
// would only surface as a broken `npm run build` in someone's fresh
// project, not as a type error here.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';

const cliEntry = resolve(import.meta.dirname, '../src/index.ts');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'purity-cli-scaffold-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function scaffold(args: string[]): string {
  return execFileSync(
    process.execPath,
    ['--experimental-strip-types', cliEntry, ...args],
    { cwd: dir, encoding: 'utf8' },
  );
}

function scaffoldExpectFailure(args: string[]): string {
  try {
    scaffold(args);
    throw new Error('expected the CLI to exit non-zero');
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    expect(e.status).not.toBe(0);
    return String(e.stderr ?? '');
  }
}

function readProjectFile(projectName: string, file: string): string {
  return readFileSync(join(dir, projectName, file), 'utf8');
}

function readPackageJson(projectName: string): {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(readProjectFile(projectName, 'package.json'));
}

describe('scaffold — default (client-only) mode', () => {
  it('generates the client-only script set with no server dependencies', () => {
    scaffold(['my-app']);
    const pkg = readPackageJson('my-app');
    expect(pkg.scripts).toEqual({
      dev: 'vite',
      typecheck: 'tsc --noEmit',
      build: 'npm run typecheck && vite build',
      preview: 'vite preview',
    });
    expect(Object.keys(pkg.dependencies)).toEqual(['@purityjs/core']);
    expect(pkg.devDependencies['@purityjs/ssr']).toBeUndefined();
    expect(pkg.devDependencies['@types/node']).toBeUndefined();
  });

  it('writes index.html pointing at src/main.ts with no SSR outlet', () => {
    scaffold(['my-app']);
    const html = readProjectFile('my-app', 'index.html');
    expect(html).toContain('/src/main.ts');
    expect(html).not.toContain('ssr-outlet');
  });

  it('generates a tsconfig with no server-only compiler options', () => {
    scaffold(['my-app']);
    const tsconfig = JSON.parse(readProjectFile('my-app', 'tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toBeUndefined();
    expect(tsconfig.compilerOptions.allowImportingTsExtensions).toBeUndefined();
    expect(tsconfig.include).toEqual(['src']);
  });

  it('generates a vite.config.ts with no route plugin options and a core-only alias', () => {
    scaffold(['my-app']);
    const config = readProjectFile('my-app', 'vite.config.ts');
    expect(config).toContain('plugins: [purity()]');
    expect(config).toContain("'@purityjs/core':");
    expect(config).not.toContain("'@purityjs/core/compiler':");
    expect(config).not.toContain("'@purityjs/ssr':");
  });
});

describe('scaffold — --ssr mode', () => {
  it('generates the SSR script set, sharing build:client/build:server/build:bootstrap with --app', () => {
    scaffold(['my-ssr-app', '--ssr']);
    const pkg = readPackageJson('my-ssr-app');
    expect(pkg.scripts).toEqual({
      dev: 'node --experimental-strip-types server.ts',
      typecheck: 'tsc --noEmit',
      build: 'npm run typecheck && npm run build:client && npm run build:server && npm run build:bootstrap',
      'build:client': 'vite build --outDir dist/client',
      'build:server': 'vite build --ssr src/entry.server.ts --outDir dist/server',
      'build:bootstrap':
        'tsc --ignoreConfig server.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node --outDir dist',
      start: 'node dist/server.js --production',
      preview: 'npm run start',
    });
    expect(pkg.dependencies['@purityjs/ssr']).toBeDefined();
    expect(pkg.devDependencies['@types/node']).toBe('^25.9.1');
  });

  it('writes an index.html with an SSR outlet comment and app.ts/entry.server.ts/entry.client.ts/server.ts', () => {
    scaffold(['my-ssr-app', '--ssr']);
    expect(readProjectFile('my-ssr-app', 'index.html')).toContain('<!--ssr-outlet-->');
    expect(readProjectFile('my-ssr-app', 'src/app.ts')).toContain('export function App()');
    expect(readProjectFile('my-ssr-app', 'src/entry.server.ts')).toContain(
      "import { renderToString } from '@purityjs/ssr'",
    );
    expect(readProjectFile('my-ssr-app', 'src/entry.client.ts')).toContain(
      "import { hydrate } from '@purityjs/core'",
    );
    expect(readProjectFile('my-ssr-app', 'server.ts')).toContain('createHttpServer');
  });

  it('generates a tsconfig with node types, allowImportingTsExtensions, and server.ts included', () => {
    scaffold(['my-ssr-app', '--ssr']);
    const tsconfig = JSON.parse(readProjectFile('my-ssr-app', 'tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toEqual(['node']);
    expect(tsconfig.compilerOptions.allowImportingTsExtensions).toBe(true);
    expect(tsconfig.include).toEqual(['src', 'server.ts']);
  });

  it('generates a vite.config.ts with the core/compiler + ssr aliases and no route plugin options', () => {
    scaffold(['my-ssr-app', '--ssr']);
    const config = readProjectFile('my-ssr-app', 'vite.config.ts');
    expect(config).toContain('plugins: [purity()]');
    expect(config).toContain("'@purityjs/core/compiler':");
    expect(config).toContain("'@purityjs/ssr':");
  });

  it('writes a README with build/start instructions (app mode does not)', () => {
    scaffold(['my-ssr-app', '--ssr']);
    expect(readProjectFile('my-ssr-app', 'README.md')).toContain('npm run build');
  });
});

describe('scaffold — --app mode', () => {
  it('generates the app script set, sharing build:client/build:server/build:bootstrap with --ssr, plus build:static', () => {
    scaffold(['my-full-app', '--app']);
    const pkg = readPackageJson('my-full-app');
    expect(pkg.scripts).toEqual({
      dev: 'node --experimental-strip-types server.ts',
      typecheck: 'node --experimental-strip-types prepare-types.ts && tsc --noEmit',
      build:
        'npm run typecheck && npm run build:client && npm run build:server && npm run build:bootstrap && npm run build:static',
      'build:client': 'vite build --outDir dist/client',
      'build:server': 'vite build --ssr src/entry.server.ts --outDir dist/server',
      'build:bootstrap':
        'tsc --ignoreConfig server.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node --outDir dist',
      'build:static': 'node --experimental-strip-types build.ts',
      start: 'node dist/server.js --production',
      preview: 'npm run start',
    });
    expect(pkg.dependencies['@purityjs/ssr']).toBeDefined();
    expect(pkg.devDependencies['@types/node']).toBe('^25.9.1');
  });

  it('generates a tsconfig including build.ts/prepare-types.ts/the routes manifest', () => {
    scaffold(['my-full-app', '--app']);
    const tsconfig = JSON.parse(readProjectFile('my-full-app', 'tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toEqual(['node']);
    expect(tsconfig.include).toEqual([
      'src',
      'server.ts',
      'build.ts',
      'prepare-types.ts',
      'src/.purity/routes.d.ts',
    ]);
  });

  it('generates a vite.config.ts with routes plugin options', () => {
    scaffold(['my-full-app', '--app']);
    const config = readProjectFile('my-full-app', 'vite.config.ts');
    expect(config).toContain(
      "plugins: [purity({ routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' } })]",
    );
  });

  it('copies the app template instead of writing a README (--ssr writes one, --app does not add one here)', () => {
    scaffold(['my-full-app', '--app']);
    // writeAppTemplate() supplies its own README from the template dir —
    // index.ts's ssrMode-only README branch must not also fire for --app.
    expect(readProjectFile('my-full-app', '.gitignore')).toContain('src/.purity');
  });
});

describe('scaffold — validation', () => {
  it('rejects passing both --app and --ssr', () => {
    const stderr = scaffoldExpectFailure(['my-app', '--app', '--ssr']);
    expect(stderr).toContain('Choose either --app or --ssr');
  });

  it('rejects a project name that looks like a path traversal attempt', () => {
    const stderr = scaffoldExpectFailure(['../escape']);
    expect(stderr).toContain('Invalid project name');
  });

  it('rejects a project name starting with a dot', () => {
    const stderr = scaffoldExpectFailure(['.hidden']);
    expect(stderr).toContain('Invalid project name');
  });

  it('refuses to overwrite an existing directory', () => {
    scaffold(['my-app']);
    const stderr = scaffoldExpectFailure(['my-app']);
    expect(stderr).toContain('already exists');
  });
});
