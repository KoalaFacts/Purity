import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { purity } from '../../packages/vite-plugin/dist/index.js';

interface Sizes {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}
interface Measurement extends Sizes {
  profile: string;
  chunks: Array<Sizes & { file: string }>;
}

const root = resolve(import.meta.dirname, '../..');
const fixture = join(import.meta.dirname, 'counter.ts');
const outputDir = join(root, 'benchmark/dist/bundle-size');
const measureOnly = process.argv.includes('--measure-only');
const verify = process.argv.includes('--verify');
assert(
  process.argv.slice(2).every((arg) => arg === '--measure-only' || arg === '--verify'),
  'Unknown argument',
);
const payloads = new Map<string, string>();
assert(
  !/conditions(?:=|\s+)[^ ]*development/.test(
    [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' '),
  ),
  'Run without the development export condition; measure built packages',
);

function sizes(source: string): Sizes {
  const bytes = Buffer.from(source);
  return {
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

async function measure(aot: boolean): Promise<Measurement> {
  let fixtureSeen = false;
  const inspectTransform: Plugin = {
    name: 'purity-bundle-size-transform-proof',
    enforce: 'post',
    transform(code, id) {
      if (resolve(id.split('?')[0]) !== fixture) return;
      fixtureSeen = true;
      assert.equal(code.includes('__purity_tpl_'), aot, 'Unexpected fixture compilation path');
      assert.equal(/html`/.test(code), !aot, 'Unexpected runtime template path');
    },
  };
  const result = await build({
    root,
    configFile: false,
    mode: 'production',
    logLevel: 'error',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [...(aot ? [purity()] : []), inspectTransform],
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: { input: fixture, output: { entryFileNames: 'entry.js' } },
    },
  });
  assert(fixtureSeen, 'Fixture did not pass through the build pipeline');
  assert(!Array.isArray(result) && 'output' in result, 'Expected one production output');
  const chunks = result.output.filter((item) => item.type === 'chunk');
  assert(
    chunks.some((chunk) => chunk.isEntry),
    'Missing JavaScript entry',
  );
  assert.equal(chunks.length, result.output.length, 'Unexpected non-JavaScript payload');
  const files = new Set(chunks.map((chunk) => chunk.fileName));
  for (const chunk of chunks) {
    assert(chunk.code.length > 0, 'Empty output');
    assert.equal(chunk.dynamicImports.length, 0, 'Fixture must not hide lazy payload');
    assert(
      chunk.imports.every((name) => files.has(name)),
      'Unbundled external dependency',
    );
  }
  const renderedModules = chunks.flatMap((chunk) =>
    Object.entries(chunk.modules)
      .filter(([, info]) => info.renderedLength > 0)
      .map(([id]) => id.replaceAll('\\', '/')),
  );
  assert(
    renderedModules.some((id) => id.includes('/packages/core/dist/')),
    'Missing built core',
  );
  assert(
    !renderedModules.some((id) => id.includes('/packages/core/src/')),
    'Source export measured',
  );
  const profile = aot ? 'counter-aot' : 'counter-runtime';
  for (const chunk of chunks) payloads.set(`/${profile}/${chunk.fileName}`, chunk.code);
  const measured = chunks.map((chunk) => ({ file: chunk.fileName, ...sizes(chunk.code) }));
  const total = measured.reduce(
    (sum, item) => ({
      rawBytes: sum.rawBytes + item.rawBytes,
      gzipBytes: sum.gzipBytes + item.gzipBytes,
      brotliBytes: sum.brotliBytes + item.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
  return { profile, ...total, chunks: measured };
}

async function verifyCounters(): Promise<{ status: string; chromium?: string }> {
  if (!verify) return { status: 'not-run' };
  const { chromium } = await import('playwright');
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const payload = payloads.get(path);
    if (payload !== undefined) {
      response.setHeader('content-type', 'text/javascript; charset=utf-8');
      response.end(payload);
    } else if (measurements.some((item) => path === `/${item.profile}/`)) {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (path === '/counter-aot/') {
        response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'");
      }
      response.end(
        '<!doctype html><html><body><main id="app"></main><script type="module" src="entry.js"></script></body></html>',
      );
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
    } else response.writeHead(404).end();
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  try {
    const browser = await chromium.launch();
    try {
      for (const item of measurements) {
        const page = await browser.newPage();
        try {
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          await page.goto(
            `http://127.0.0.1:${(server.address() as AddressInfo).port}/${item.profile}/`,
          );
          await page.getByRole('button', { name: 'Count: 0', exact: true }).waitFor();
          for (let i = 0; i < 3; i++) {
            await page.getByRole('button', { name: `Count: ${i}`, exact: true }).click();
            await page.getByRole('button', { name: `Count: ${i + 1}`, exact: true }).waitFor();
          }
          assert.deepEqual(errors, [], `${item.profile} browser errors`);
        } finally {
          await page.close();
        }
      }
      return { status: 'passed', chromium: browser.version() };
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}

async function packageVersion(path: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
  assert.equal(typeof pkg.version, 'string');
  return pkg.version;
}

const budgets = JSON.parse(await readFile(join(import.meta.dirname, 'budgets.json'), 'utf8'));
const measurements = [await measure(false), await measure(true)];
const verification = await verifyCounters();
const violations: string[] = [];
for (const item of measurements) {
  for (const metric of ['gzipBytes', 'brotliBytes'] as const) {
    const budget = budgets[item.profile]?.[metric];
    assert(Number.isSafeInteger(budget) && budget > 0, 'Invalid size budget');
    if (item[metric] > budget)
      violations.push(`${item.profile}: ${metric} ${item[metric]} > ${budget}`);
  }
}
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const report = {
  schemaVersion: 1,
  revision: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0,
  node: process.versions.node,
  zlib: process.versions.zlib,
  brotli: process.versions.brotli,
  versions: {
    core: await packageVersion('packages/core'),
    plugin: await packageVersion('packages/vite-plugin'),
    vite: await packageVersion('node_modules/vite'),
  },
  fixtureSha256: createHash('sha256')
    .update((await readFile(fixture, 'utf8')).replaceAll('\r\n', '\n'))
    .digest('hex'),
  artifactsSha256: {
    core: createHash('sha256')
      .update(await readFile(join(root, 'packages/core/dist/index.js')))
      .digest('hex'),
    plugin: createHash('sha256')
      .update(await readFile(join(root, 'packages/vite-plugin/dist/index.js')))
      .digest('hex'),
  },
  verification,
  settings: {
    target: 'es2022',
    minify: true,
    gzipLevel: 9,
    brotliQuality: 11,
    perFileCompression: true,
  },
  scope:
    'Complete counter JavaScript payload from built packages; includes application code, excludes HTML and source maps.',
  measurements,
  budgets,
  violations,
  budgetEnforced: !measureOnly,
};
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const summary = [
  '## Purity production counter bundle sizes',
  '',
  `Revision: ${report.revision}; dirty: ${report.dirty}; Node: ${report.node}`,
  `Core: ${report.versions.core}; plugin: ${report.versions.plugin}; Vite: ${report.versions.vite}`,
  '',
  '| Profile | Raw bytes | gzip bytes | Brotli bytes |',
  '| --- | ---: | ---: | ---: |',
  ...measurements.map(
    (item) => `| ${item.profile} | ${item.rawBytes} | ${item.gzipBytes} | ${item.brotliBytes} |`,
  ),
  '',
  report.scope,
  'Compression is per emitted JavaScript file. These are fixture results, not a universal framework size.',
  `Browser verification: ${verification.status}${verification.chromium ? ` (Chromium ${verification.chromium})` : ''}.`,
  `Budget checks: ${measureOnly ? 'not enforced' : violations.length ? 'failed' : 'passed'}.`,
  ...violations,
  '',
].join('\n');
console.log(summary);
await writeFile(join(outputDir, 'report.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (!measureOnly && violations.length) process.exitCode = 1;
