#!/usr/bin/env node
// Generates the GitHub Pages benchmark dashboard.
//
// 1. Parses benchmark-results.md + history/ into JSON
// 2. Injects the JSON into the Vite-built Purity report app
// 3. Outputs gh-pages/index.html

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const historyDir = 'benchmark/history';
const resultsFile = 'benchmark/benchmark-results.md';
const distDir = 'benchmark/dist';
const outDir = 'gh-pages';

// ---------------------------------------------------------------------------
// Parse speed results: | Category | Operation | Purity | Solid | Svelte | Vue | Winner |
// ---------------------------------------------------------------------------

function parseSpeedResults(md: string) {
  // Only parse the ## Full Results section (stop at ## Memory Results)
  const fullIdx = md.indexOf('## Full Results');
  if (fullIdx === -1) return [];
  let section = md.slice(fullIdx);
  const memIdx = section.indexOf('## Memory Results');
  if (memIdx !== -1) section = section.slice(0, memIdx);

  const lines = section.split('\n').filter((l) => l.startsWith('|'));
  if (lines.length < 3) return [];

  const headerCells = lines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
  const hasCategory = headerCells.length >= 6;

  let lastCategory = '';
  return lines
    .slice(2)
    .map((line) => {
      // Split by | and drop leading/trailing empty entries (from | at start/end)
      const raw = line.split('|').map((c) => c.trim());
      const cells = raw.slice(1, raw.length - 1); // drop first/last empty strings

      if (hasCategory) {
        if (cells.length < 7) return null;
        const cat = cells[0] || lastCategory;
        if (cells[0]) lastCategory = cells[0];
        return {
          category: cat,
          op: cells[1],
          purity: parseFloat(cells[2]),
          solid: parseFloat(cells[3]),
          svelte: parseFloat(cells[4]),
          vue: parseFloat(cells[5]),
          winner: cells[6].replace(/\*/g, ''),
        };
      }
      if (cells.length < 5) return null;
      return {
        category: '',
        op: cells[0],
        purity: parseFloat(cells[1]),
        solid: parseFloat(cells[2]),
        svelte: parseFloat(cells[3]),
        vue: NaN,
        winner: cells[4].replace(/\*/g, ''),
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Parse memory results
// ---------------------------------------------------------------------------

function parseMemoryResults(md: string) {
  const memIdx = md.indexOf('## Memory Results');
  if (memIdx === -1) return [];
  const section = md.slice(memIdx);
  const lines = section.split('\n').filter((l) => l.startsWith('|'));
  if (lines.length < 3) return [];

  return lines
    .slice(2)
    .map((line) => {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length < 10) return null;
      return {
        op: cells[0],
        purityUsed: parseFloat(cells[1]),
        solidUsed: parseFloat(cells[2]),
        svelteUsed: parseFloat(cells[3]),
        vueUsed: parseFloat(cells[4]),
        purityRetained: parseFloat(cells[5]),
        solidRetained: parseFloat(cells[6]),
        svelteRetained: parseFloat(cells[7]),
        vueRetained: parseFloat(cells[8]),
        bestCleanup: cells[9].replace(/\*/g, ''),
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Manage history
// ---------------------------------------------------------------------------

const historyFiles = existsSync(historyDir)
  ? readdirSync(historyDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
  : [];

// Prune to 3 most recent
for (let i = 3; i < historyFiles.length; i++) {
  unlinkSync(join(historyDir, historyFiles[i]));
}

const recentFiles = historyFiles.slice(0, 3);

// ---------------------------------------------------------------------------
// Build data payload
// ---------------------------------------------------------------------------

const currentMd = readFileSync(resultsFile, 'utf8');
const benchData = {
  speed: parseSpeedResults(currentMd),
  memory: parseMemoryResults(currentMd),
  history: recentFiles.map((f) => {
    const md = readFileSync(join(historyDir, f), 'utf8');
    const date = f
      .replace('.md', '')
      .replace(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
    return {
      date,
      speed: parseSpeedResults(md),
      memory: parseMemoryResults(md),
    };
  }),
};

// ---------------------------------------------------------------------------
// Inject data into built report page
// ---------------------------------------------------------------------------

const reportHtml = readFileSync(join(distDir, 'apps/purity/report.html'), 'utf8');

// Replace the placeholder JSON in the <script id="bench-data"> tag
const injected = reportHtml.replace(
  /(<script id="bench-data" type="application\/json">)([\s\S]*?)(<\/script>)/,
  `$1${JSON.stringify(benchData)}$3`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), injected);

// Copy assets
const assetsDir = join(distDir, 'assets');
if (existsSync(assetsDir)) {
  mkdirSync(join(outDir, 'assets'), { recursive: true });
  for (const f of readdirSync(assetsDir)) {
    cpSync(join(assetsDir, f), join(outDir, 'assets', f));
  }
}

console.log(
  `Generated ${outDir}/index.html (${benchData.speed.length} speed ops, ${benchData.memory.length} memory ops, ${benchData.history.length} history runs)`,
);

// ---------------------------------------------------------------------------
// Copy the dashboard demo (if it has been built) into /dashboard/.
// The demo lives in `examples/dashboard/`; deployed at /Purity/dashboard/.
// ---------------------------------------------------------------------------

const demoDist = 'examples/dashboard/dist';
if (existsSync(demoDist)) {
  cpSync(demoDist, join(outDir, 'dashboard'), { recursive: true });
  console.log('Copied examples/dashboard/dist → gh-pages/dashboard/');
}
