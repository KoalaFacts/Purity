import { expect, it } from 'vite-plus/test';
import { compareSizeReports } from '../bundle-size/compare-reports.ts';

function examples() {
  const base = {
    revision: 'baseline-commit',
    dirty: false,
    schemaVersion: 3,
    node: '24.21.0',
    zlib: 'fixed',
    brotli: 'fixed',
    versions: { core: '0.5.0', vite: '1.3.0' },
    fixtureHashes: { 'controls.ts': 'same-source' },
    settings: { brotliQuality: 11, minify: true },
    scope: 'complete application JS payload',
    budgets: { packages: { 'core-all': { brotliBytes: 40704 }, 'core-actions': { brotliBytes: 5248 } } },
    packages: [
      { entry: 'core-all', rawBytes: 200, gzipBytes: 100, brotliBytes: 80 },
      { entry: 'core-actions', rawBytes: 100, gzipBytes: 50, brotliBytes: 40 },
    ],
    measurements: [
      {
        profile: 'controls-runtime',
        rawBytes: 1200,
        gzipBytes: 600,
        brotliBytes: 500,
        functionConstructorCalls: 1,
        chunks: [
          { file: 'entry.js', rawBytes: 700, gzipBytes: 350, brotliBytes: 300 },
          { file: 'lazy.js', rawBytes: 500, gzipBytes: 250, brotliBytes: 200 },
        ],
      },
    ],
  };
  const next = structuredClone(base);
  next.revision = 'candidate-commit';
  next.packages[0].brotliBytes -= 8;
  next.measurements[0].brotliBytes += 15;
  next.measurements[0].chunks[1].brotliBytes += 15;
  return { base, next };
}

it('SV2-015: full core reduction does not mask an application and lazy-chunk regression', () => {
  const { base, next } = examples();
  const result = compareSizeReports(base, next);
  expect(result.packages.find((entry) => entry.name === 'core-all')?.brotli).toBe(-8);
  expect(result.appGrowth.map((entry) => entry.name)).toEqual(['controls-runtime']);
  expect(result.apps[0].brotli).toBe(15);
  expect(result.apps[0].chunks?.map((chunk) => chunk.brotli)).toEqual([0, 15]);
  expect(result.budgetViolations).toHaveLength(0);
});

it('SV2-015: rejects nonmatching inputs rather than presenting a false size delta', () => {
  const { base, next } = examples();
  next.fixtureHashes['controls.ts'] = 'changed-input';
  expect(() => compareSizeReports(base, next)).toThrow(/INCOMPARABLE: changed fixtureHashes/);
  next.fixtureHashes['controls.ts'] = 'same-source';
  next.node = '22.16.0';
  expect(() => compareSizeReports(base, next)).toThrow(/INCOMPARABLE: changed node/);
});

it('SV2-015: reports renamed or missing JS chunks, but rejects incomplete byte accounting', () => {
  const { base, next } = examples();
  next.measurements[0].chunks[1].file = 'silently-renamed.js';
  const moved = compareSizeReports(base, next).apps[0].chunks;
  expect(moved?.filter((chunk) => chunk.chunkState === 'removed')).toHaveLength(1);
  expect(moved?.filter((chunk) => chunk.chunkState === 'added')).toHaveLength(1);
  next.measurements[0].chunks[1].file = 'lazy.js';
  next.measurements[0].chunks[0].gzipBytes += 1;
  expect(() => compareSizeReports(base, next)).toThrow(/Unaccounted JS chunk bytes/);
  next.measurements[0].chunks.length = 0;
  expect(() => compareSizeReports(base, next)).toThrow(/Missing full JS chunk inventory/);
});

it('SV2-015: matches generated content-hash filenames by logical chunk identity', () => {
  const { base, next } = examples();
  base.measurements[0].chunks[1].file = 'lazy-AbCd1234.js';
  next.measurements[0].chunks[1].file = 'lazy-EfGh5678.js';
  const lazy = compareSizeReports(base, next).apps[0].chunks?.find((chunk) => chunk.name === 'lazy.js');
  expect(lazy?.chunkState).toBe('matched');
  expect(lazy?.brotli).toBe(15);
  expect(lazy?.previousFilename).toBe('lazy-AbCd1234.js');
  expect(lazy?.candidateFilename).toBe('lazy-EfGh5678.js');
});

it('SV2-015: rejects equally missing required metadata on both archives', () => {
  const { base, next } = examples();
  delete (base as Partial<typeof base>).fixtureHashes;
  delete (next as Partial<typeof next>).fixtureHashes;
  expect(() => compareSizeReports(base, next)).toThrow(/Missing fixtureHashes/);
});

it('SV2-015: individual JS chunk growth is visible even if the app total is unchanged', () => {
  const { base, next } = examples();
  next.measurements[0].brotliBytes = base.measurements[0].brotliBytes;
  next.measurements[0].chunks[0].brotliBytes -= 15;
  const result = compareSizeReports(base, next);
  expect(result.apps[0].brotli).toBe(0);
  expect(result.apps[0].chunks?.find((chunk) => chunk.name === 'lazy.js')?.brotli).toBe(15);
});

it('SV2-015: detects duplicate profile, dirty run and original package budget exceedance', () => {
  const { base, next } = examples();
  next.measurements.push(structuredClone(next.measurements[0]));
  expect(() => compareSizeReports(base, next)).toThrow(/Duplicate entry\/profile/);
  next.measurements.pop();
  next.dirty = true;
  expect(() => compareSizeReports(base, next)).toThrow(/Dirty build/);
  next.dirty = false;
  next.packages[0].brotliBytes = 40705;
  expect(compareSizeReports(base, next).budgetViolations.map((entry) => entry.name)).toEqual(['core-all']);
  next.packages[0].brotliBytes = 72;
  next.budgets.packages['core-all'].brotliBytes = 40705;
  expect(() => compareSizeReports(base, next)).toThrow(/Original Brotli budget missing or changed/);
});
