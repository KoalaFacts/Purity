// Verify the actual Vercel builder and isolate runtime without linking or deploying.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const exampleRoot = resolve(import.meta.dirname, '..');
const exampleRequire = createRequire(join(exampleRoot, 'package.json'));
const vercelRequire = createRequire(exampleRequire.resolve('vercel/package.json'));
const builderRequire = createRequire(vercelRequire.resolve('@vercel/node/package.json'));
const { build } = vercelRequire('@vercel/node');
const { EdgeFunction, glob } = builderRequire('@vercel/build-utils');
const { EdgeRuntime } = builderRequire('edge-runtime');
const esbuild = builderRequire('esbuild');
const scratch = await mkdtemp(join(tmpdir(), 'purity-vercel-edge-'));

try {
  await cp(join(exampleRoot, 'api'), join(scratch, 'api'), { recursive: true });
  // Pre-fix builds put the bundle in api; the stable entry uses dist after the fix.
  try {
    await cp(join(exampleRoot, 'dist'), join(scratch, 'dist'), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(
    join(scratch, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      engines: { node: '24.x' },
    }),
  );
  const result = await build({
    files: await glob('**/*', scratch),
    entrypoint: 'api/stream.js',
    workPath: scratch,
    repoRootPath: scratch,
    considerBuildCommand: true,
    config: { zeroConfig: true, projectSettings: { installCommand: '', buildCommand: '' } },
    meta: { skipDownload: true },
  });
  assert.ok(
    result.output instanceof EdgeFunction,
    `api/stream.js must be recognized as an EdgeFunction; got ${result.output.type}`,
  );
  assert.equal(result.output.deploymentTarget, 'v8-worker');
  const outputDir = join(scratch, 'output');
  for (const [name, file] of Object.entries(result.output.files)) {
    const target = join(outputDir, name);
    await mkdir(dirname(target), { recursive: true });
    if (file.type === 'FileFsRef') await cp(file.fsPath, target);
    else {
      assert.equal(file.type, 'FileBlob');
      await writeFile(target, file.data);
    }
  }
  const bundled = await esbuild.build({
    entryPoints: [join(outputDir, result.output.entrypoint)],
    bundle: true,
    format: 'iife',
    globalName: 'purityEntry',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  const runtime = new EdgeRuntime({
    initialCode:
      bundled.outputFiles[0].text +
      '\naddEventListener("fetch", event => event.respondWith(purityEntry.default(event.request)));',
  });
  assert.equal(runtime.evaluate('typeof process'), 'undefined');
  assert.equal(runtime.evaluate('typeof require'), 'undefined');
  const cases = [
    ['/', 'Hello from Vercel Edge'],
    ['/stream', 'Vercel Edge runs on V8 isolates'],
    ['/missing-path', 'No route matches'],
  ];
  for (const [path, expected] of cases) {
    const response = await runtime.dispatchFetch(`https://example.test${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
    const html = chunks.join('');
    assert.match(html, /^<!doctype html>/i);
    assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
    assert.ok(html.includes(expected), `${path} must render the expected route`);
    if (path === '/stream') {
      const loading = chunks.findIndex((chunk) => chunk.includes('loading the slow region'));
      const resolved = chunks.findIndex((chunk) => chunk.includes(expected));
      assert.ok(
        loading >= 0 && resolved > loading,
        'Loading shell must stream before resolved content',
      );
      assert.match(html, /<template id="purity-s-/);
    }
    console.log(`Edge isolate ${path}: ${chunks.length} chunks; response assertions passed`);
  }
  const cli = JSON.parse(await readFile(vercelRequire.resolve('./package.json'), 'utf8'));
  console.log(`Vercel ${cli.version}: EdgeFunction builder and isolated streaming checks passed`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
