import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { anchorsOf, checkDocs, isHistorical, linksOf, slugify } from './check-docs.ts';

let root = '';

function repo(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), 'check-docs-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      scripts: { test: 'x', check: 'y' },
      workspaces: ['packages/*'],
    }),
    'packages/core/package.json': JSON.stringify({
      name: '@purityjs/core',
      scripts: { bench: 'z' },
    }),
    'README.md': 'See [docs](./docs/README.md).\n',
    'docs/README.md': '# Docs\n\n- [Guide](./guide.md)\n- [ADRs](./decisions/README.md)\n',
    'docs/guide.md': '# Guide\n\n## Quick start\n\nRun `npm run test`.\n',
    'docs/decisions/README.md': '# ADRs\n\n- [0001](./0001-first.md)\n',
    'docs/decisions/0001-first.md': '# 0001\n',
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function messages(dir: string): string[] {
  return checkDocs(dir).map((p) => `${p.file}: ${p.message}`);
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('check-docs helpers', () => {
  it('slugs headings like GitHub', () => {
    assert.equal(slugify('1. Baseline at `1c76af6`'), '1-baseline-at-1c76af6');
    assert.equal(slugify('P1 — hot paths'), 'p1--hot-paths');
    assert.equal(slugify('SSR + hydration'), 'ssr--hydration');
  });

  it('collects heading anchors, duplicate suffixes and explicit ids, ignoring fenced code', () => {
    const anchors = anchorsOf('# A\n\n## A\n\n<a id="cq-01"></a>\n\n```md\n# Not a heading\n```\n');
    assert.deepEqual([...anchors].sort(), ['a', 'a-1', 'cq-01']);
  });

  it('ignores explicit HTML ids that appear only in fenced examples', () => {
    const markdown =
      '# Guide\n\n```html\n<a id="phantom"></a>\n```\n\n<a id="real"></a>\n\n[Broken](#phantom)\n';
    const anchors = anchorsOf(markdown);
    assert.equal(anchors.has('phantom'), false);
    assert.equal(anchors.has('real'), true);
  });

  it('extracts links but not inline-code or fenced examples', () => {
    const links = linksOf('[a](./a.md) `[b](./b.md)`\n\n```\n[c](./c.md)\n```\n[d]: ./d.md\n');
    assert.deepEqual(
      links.map((l) => l.target),
      ['./a.md', './d.md'],
    );
  });

  it('treats ADRs, release notes, archives and dated docs as historical', () => {
    assert.equal(isHistorical('docs/decisions/0005-x.md'), true);
    assert.equal(isHistorical('docs/archive/old.md'), true);
    assert.equal(isHistorical('docs/code-quality-audit-2026-11-05.md'), true);
    assert.equal(isHistorical('docs/guide.md'), false);
    assert.equal(isHistorical('CHANGELOG.md'), true);
  });
});

describe('checkDocs', () => {
  it('passes a consistent tree', () => {
    assert.deepEqual(messages(repo({})), []);
  });

  it('reports a broken relative link and a missing anchor', () => {
    const out = messages(
      repo({ 'docs/guide.md': '# Guide\n\n[x](./missing.md) [y](./README.md#nope) [z](#guide)\n' }),
    );
    assert.deepEqual(out, [
      'docs/guide.md: line 3: broken link "./missing.md"',
      'docs/guide.md: line 3: missing anchor "#nope" in docs/README.md',
    ]);
  });

  it('reports docs unreachable from the index and a README without an index link', () => {
    const out = messages(repo({ 'docs/orphan.md': '# Orphan\n', 'README.md': '# Purity\n' }));
    assert.deepEqual(out, [
      'README.md: does not link to docs/README.md',
      'docs/orphan.md: not reachable from the docs index (docs/README.md)',
    ]);
  });

  it('reports missing named paths and npm scripts in current docs only', () => {
    const body =
      'Edit `packages/core/src/gone.ts:12` and run `npm run nope` or `npm run bench -w packages/core`.\n';
    const out = messages(
      repo({
        'docs/guide.md': `# Guide\n\n${body}`,
        'docs/decisions/0001-first.md': `# 0001\n\n${body}`,
      }),
    );
    assert.deepEqual(out, [
      'docs/guide.md: npm script "nope" does not exist in root package.json',
      'docs/guide.md: named path `packages/core/src/gone.ts` does not exist',
    ]);
  });

  it('reports an unknown workspace selector', () => {
    const out = messages(
      repo({ 'docs/guide.md': '# Guide\n\n`npm run bench -w packages/nope`\n' }),
    );
    assert.deepEqual(out, [
      'docs/guide.md: npm workspace "packages/nope" does not exist (npm run bench)',
    ]);
  });

  it('reports ADR numbering gaps and ADRs missing from the index', () => {
    const out = messages(repo({ 'docs/decisions/0003-third.md': '# 0003\n' }));
    assert.deepEqual(out, [
      'docs/decisions/0003-third.md: not reachable from the docs index (docs/README.md)',
      'docs/decisions/README.md: ADR 0003-third.md is not listed in the ADR index',
      'docs/decisions: ADR numbering gap: expected 0002',
    ]);
  });
});
