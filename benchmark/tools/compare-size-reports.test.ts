import currentBudgets from '../bundle-size/budgets.json' with { type: 'json' };
import budgets from '../bundle-size/budgets-v3.json' with { type: 'json' };
import { expect, it } from 'vite-plus/test';
import { compareSizeReports } from '../bundle-size/compare-reports.ts';

function examples() {
  const base = {
    revision: 'a'.repeat(40),
    dirty: false,
    schemaVersion: 3,
    node: '24.21.0',
    zlib: 'fixed',
    brotli: 'fixed',
    versions: { core: '0.5.0', ssr: '0.5.0', plugin: '0.5.0', vite: '1.3.0', parser: '0.154.0' },
    fixtureHashes: Object.fromEntries(
      [
        'counter.ts',
        'controls.ts',
        'controls-view.ts',
        'form.ts',
        'hydration.ts',
        'resource.ts',
        'controls-server.ts',
      ].map((name) => [name, 'a'.repeat(64)]),
    ),
    settings: {
      target: 'es2022',
      brotliQuality: 11,
      gzipLevel: 9,
      minify: true,
      perFileCompression: true,
    },
    scope: 'complete application JS payload',
    budgets: structuredClone(budgets),
    packages: [
      {
        entry: 'core-all',
        functionConstructorCalls: 1,
        rawBytes: 200,
        gzipBytes: 100,
        brotliBytes: 80,
      },
      {
        entry: 'core-actions',
        functionConstructorCalls: 0,
        rawBytes: 100,
        gzipBytes: 50,
        brotliBytes: 40,
      },
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
  // Synthetic bytes, but a complete v3 producer inventory; no partial-report mode.
  for (const entry of Object.keys(base.budgets.packages)) {
    if (!base.packages.some((row) => row.entry === entry))
      base.packages.push({
        entry,
        functionConstructorCalls: 0,
        rawBytes: 100,
        gzipBytes: 50,
        brotliBytes: 40,
      });
  }
  for (const profile of Object.keys(base.budgets.fixtures)) {
    if (!base.measurements.some((row) => row.profile === profile))
      base.measurements.push({
        profile,
        rawBytes: 100,
        gzipBytes: 50,
        brotliBytes: 40,
        functionConstructorCalls: profile.endsWith('-aot') ? 0 : 1,
        chunks: [{ file: 'entry.js', rawBytes: 100, gzipBytes: 50, brotliBytes: 40 }],
      });
  }
  const next = structuredClone(base);
  next.revision = 'b'.repeat(40);
  next.packages[0].brotliBytes -= 8;
  next.measurements[0].brotliBytes += 15;
  next.measurements[0].chunks[1].brotliBytes += 15;
  return { base, next };
}

function expandedExamples() {
  const { base, next } = examples();
  for (const report of [base, next]) {
    report.schemaVersion = 4;
    report.budgets = structuredClone(currentBudgets);
    report.fixtureHashes['counter-client.ts'] = 'a'.repeat(64);
    for (const entry of Object.keys(report.budgets.packages)) {
      if (!report.packages.some((row) => row.entry === entry)) {
        report.packages.push({
          entry,
          functionConstructorCalls: 1,
          rawBytes: 100,
          gzipBytes: 50,
          brotliBytes: 40,
        });
      }
    }
    for (const profile of Object.keys(report.budgets.fixtures)) {
      if (!report.measurements.some((row) => row.profile === profile)) {
        report.measurements.push({
          profile,
          rawBytes: 100,
          gzipBytes: 50,
          brotliBytes: 40,
          functionConstructorCalls: profile.endsWith('-aot') ? 0 : 1,
          chunks: [{ file: 'entry.js', rawBytes: 100, gzipBytes: 50, brotliBytes: 40 }],
        });
      }
    }
  }
  return { base, next };
}

it('accepts complete v4 reports and refuses omissions of newly introduced entries', () => {
  const { base } = expandedExamples();
  const result = compareSizeReports(base, structuredClone(base));
  expect(result.packages).toHaveLength(14);
  expect(result.apps).toHaveLength(12);
  const missing = structuredClone(base);
  missing.packages = missing.packages.filter((row) => row.entry !== 'core-jit-client');
  expect(() => compareSizeReports(base, missing)).toThrow(/Incomplete v4 coverage/);
});

it('keeps historical v3 evidence valid but rejects cross-schema comparisons', () => {
  const { base: legacy } = examples();
  const { base: current } = expandedExamples();
  expect(compareSizeReports(legacy, structuredClone(legacy)).packages).toHaveLength(13);
  expect(() => compareSizeReports(legacy, current)).toThrow(/INCOMPARABLE: changed schemaVersion/);
});

it('SV2-015: full core reduction does not mask an application and lazy-chunk regression', () => {
  const { base, next } = examples();
  const result = compareSizeReports(base, next);
  expect(result.packages.find((entry) => entry.name === 'core-all')?.brotli).toBe(-8);
  expect(result.appGrowth.map((entry) => entry.name)).toEqual(['controls-runtime']);
  expect(result.apps[0].brotli).toBe(15);
  expect(result.apps[0].chunks?.map((chunk) => chunk.brotli)).toEqual([0, 15]);
  expect(result.budgetViolations).toHaveLength(0);
});

it.each(['rawBytes', 'gzipBytes'] as const)(
  'SV2-015: detects %s growth even when Brotli decreases',
  (metric) => {
    for (const { base, next } of [examples(), expandedExamples()]) {
      const before = base.measurements[0];
      const after = next.measurements[0];
      after.brotliBytes = before.brotliBytes - 1;
      after.chunks[1].brotliBytes = before.chunks[1].brotliBytes - 1;
      after[metric] = before[metric] + 1;
      after.chunks[1][metric] = before.chunks[1][metric] + 1;
      const result = compareSizeReports(base, next);
      expect(result.apps[0].brotli).toBe(-1);
      expect(result.appGrowth.map((entry) => entry.name)).toContain('controls-runtime');
    }
  },
);

it('SV2-015: reports package gzip growth despite lower Brotli', () => {
  const { base, next } = examples();
  next.packages[0].gzipBytes = base.packages[0].gzipBytes + 1;
  const result = compareSizeReports(base, next);
  expect(result.packages[0].brotli).toBe(-8);
  expect(result.packageGrowth.map((entry) => entry.name)).toContain('core-all');
});

it('SV2-015: rejects nonmatching inputs rather than presenting a false size delta', () => {
  const { base, next } = examples();
  next.fixtureHashes['controls.ts'] = 'b'.repeat(64);
  expect(() => compareSizeReports(base, next)).toThrow(/INCOMPARABLE: changed fixtureHashes/);
  next.fixtureHashes['controls.ts'] = 'a'.repeat(64);
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
  const lazy = compareSizeReports(base, next).apps[0].chunks?.find(
    (chunk) => chunk.name === 'lazy.js',
  );
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

it.each(['rawBytes', 'gzipBytes', 'brotliBytes'] as const)(
  'SV2-015: catches compensated %s growth in a required JS chunk',
  (metric) => {
    for (const { base } of [examples(), expandedExamples()]) {
      const next = structuredClone(base);
      next.measurements[0].chunks[0][metric] -= 1;
      next.measurements[0].chunks[1][metric] += 1;
      const result = compareSizeReports(base, next);
      expect(result.appGrowth).toHaveLength(0);
      expect(result.chunkGrowth.map((chunk) => chunk.name)).toEqual(['controls-runtime/lazy.js']);
    }
  },
);

it('SV2-015: identifies a newly emitted JS chunk even when total bytes are unchanged', () => {
  const { base } = examples();
  const next = structuredClone(base);
  for (const metric of ['rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
    next.measurements[0].chunks[0][metric] -= 1;
  }
  next.measurements[0].chunks.push({
    file: 'added.js',
    rawBytes: 1,
    gzipBytes: 1,
    brotliBytes: 1,
  });
  const result = compareSizeReports(base, next);
  expect(result.appGrowth).toHaveLength(0);
  expect(result.chunkGrowth.map((chunk) => chunk.name)).toEqual(['controls-runtime/added.js']);
  expect(result.chunkGrowth[0]?.chunkState).toBe('added');
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
  expect(compareSizeReports(base, next).budgetViolations.map((entry) => entry.name)).toEqual([
    'core-all',
  ]);
  next.packages[0].brotliBytes = 72;
  next.budgets.packages['core-all'].brotliBytes = 40705;
  expect(() => compareSizeReports(base, next)).toThrow(/Original Brotli budget missing or changed/);
});

// These corruptions used to compare equal and make the CLI claim complete evidence.
it.each([
  [
    'schema',
    (r) => {
      r.schemaVersion = 999;
    },
  ],
  [
    'brotli setting',
    (r) => {
      delete r.settings.brotliQuality;
    },
  ],
  [
    'Vite version',
    (r) => {
      delete r.versions.vite;
    },
  ],
  [
    'parser version',
    (r) => {
      delete r.versions.parser;
    },
  ],
  [
    'empty version',
    (r) => {
      r.versions.ssr = '';
    },
  ],
  [
    'package coverage',
    (r) => {
      r.packages = r.packages.filter((x) => x.entry !== 'core-signals');
    },
  ],
  [
    'application coverage',
    (r) => {
      r.measurements = r.measurements.filter((x) => x.profile !== 'resource-aot');
    },
  ],
  [
    'fixture coverage',
    (r) => {
      delete r.fixtureHashes['controls-server.ts'];
    },
  ],
  [
    'fixture hash',
    (r) => {
      r.fixtureHashes['controls.ts'] = 'not-a-sha256';
    },
  ],
  [
    'package budget',
    (r) => {
      delete r.budgets.packages['core-signals'];
    },
  ],
  [
    'fixture Function budget',
    (r) => {
      delete r.budgets.fixtures['resource-aot'].functionConstructorCalls;
    },
  ],
  [
    'Function evidence',
    (r) => {
      delete r.measurements[0].functionConstructorCalls;
    },
  ],
  [
    'negative Function evidence',
    (r) => {
      r.measurements[0].functionConstructorCalls = -1;
    },
  ],
] as Array<[string, (report: any) => void]>)(
  'rejects equally incomplete v3 reports: %s',
  (_name, corrupt) => {
    const { base } = examples();
    corrupt(base);
    expect(() => compareSizeReports(base, structuredClone(base))).toThrow();
  },
);

it('accepts complete v3 controls and rejects a missing entry on either side', () => {
  const { base } = examples();
  const result = compareSizeReports(base, structuredClone(base));
  expect(result.packages).toHaveLength(13);
  expect(result.apps).toHaveLength(10);
  const broken = structuredClone(base);
  broken.packages = broken.packages.filter((row) => row.entry !== 'core-signals');
  expect(() => compareSizeReports(base, broken)).toThrow();
  expect(() => compareSizeReports(broken, base)).toThrow();
});

it.each(['missing', 'negative'] as const)(
  'rejects equally %s package Function evidence',
  (mode) => {
    const { base } = examples();
    if (mode === 'missing')
      delete (base.packages[0] as Partial<(typeof base.packages)[number]>).functionConstructorCalls;
    else base.packages[0].functionConstructorCalls = -1;
    expect(() => compareSizeReports(base, structuredClone(base))).toThrow(
      /Function constructor evidence/,
    );
  },
);
