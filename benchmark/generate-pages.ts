#!/usr/bin/env node
// Generates the GitHub Pages benchmark dashboard from markdown results.

import {
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
const outFile = 'gh-pages/index.html';

// --- Parse markdown results into structured data ---
// The table format from run-bench.ts is:
// | Category | Operation | Purity | Solid | Svelte | Vue | Winner |
function parseResults(md) {
  const lines = md.split('\n').filter((l) => l.startsWith('|'));
  if (lines.length < 3) return []; // header + separator + at least 1 row

  // Detect column count from header
  const headerCells = lines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);

  // Support both old 5-column (no Category, no Vue) and new 7-column format
  const hasCategory = headerCells.length >= 6;

  return lines
    .slice(2)
    .map((line) => {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);

      if (hasCategory) {
        // New format: Category | Operation | Purity | Solid | Svelte | Vue | Winner
        if (cells.length < 7) return null;
        return {
          category: cells[0],
          op: cells[1],
          purity: parseFloat(cells[2]),
          solid: parseFloat(cells[3]),
          svelte: parseFloat(cells[4]),
          vue: parseFloat(cells[5]),
          winner: cells[6].replace(/\*/g, ''),
        };
      }
      // Legacy 5-column format: Operation | Purity | Solid | Svelte | Winner
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

// --- Build HTML table from parsed results ---
function resultsToTable(rows) {
  if (!rows.length) return '<p>No results available.</p>';

  const hasVue = rows.some((r) => !isNaN(r.vue));
  const hasCategory = rows.some((r) => r.category);
  const fws = hasVue ? ['Purity', 'Solid', 'Svelte', 'Vue'] : ['Purity', 'Solid', 'Svelte'];

  const wins = {};
  for (const fw of fws) wins[fw] = 0;
  for (const r of rows) if (wins[r.winner] !== undefined) wins[r.winner]++;

  let html = '<div class="scoreboard">';
  for (const [fw, count] of Object.entries(wins)) {
    const cls = fw.toLowerCase();
    html += `<div class="score-card ${cls}"><span class="score-num">${count}</span><span class="score-label">${fw}</span></div>`;
  }
  html += '</div>';

  html += '<table class="results"><thead><tr>';
  if (hasCategory) html += '<th>Category</th>';
  html += '<th>Operation</th>';
  for (const fw of fws) html += `<th>${fw}</th>`;
  html += '<th>Winner</th>';
  html += '</tr></thead><tbody>';

  for (const r of rows) {
    const vals = fws.map((fw) => r[fw.toLowerCase()]).filter((v) => !isNaN(v));
    const best = vals.length ? Math.min(...vals) : 0;

    const cell = (ms, fw) => {
      if (isNaN(ms)) return '<td class="ok">—</td>';
      const isBest = ms === best;
      const isWinner = fw === r.winner;
      const ratio = best > 0 ? ms / best : 1;
      let cls = '';
      if (isBest || isWinner) cls = 'best';
      else if (ratio > 2) cls = 'slow';
      else cls = 'ok';
      return `<td class="${cls}">${ms.toFixed(1)}ms</td>`;
    };

    const winnerCls = r.winner.toLowerCase();
    html += '<tr>';
    if (hasCategory) html += `<td class="op-name">${r.category}</td>`;
    html += `<td class="op-name">${r.op}</td>`;
    for (const fw of fws) html += cell(r[fw.toLowerCase()], fw);
    html += `<td class="winner-cell ${winnerCls}">${r.winner}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}

// --- Manage history files ---
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

// --- Build current results ---
const currentMd = readFileSync(resultsFile, 'utf8');
const currentRows = parseResults(currentMd);
const currentTable = resultsToTable(currentRows);

// --- Build previous runs ---
let previousHtml = '';
for (const f of recentFiles) {
  const md = readFileSync(join(historyDir, f), 'utf8');
  const rows = parseResults(md);
  const date = f.replace('.md', '');
  const display = date.replace(
    /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/,
    '$1-$2-$3 $4:$5:$6',
  );
  previousHtml += `<details class="history-run"><summary>${display}</summary>${resultsToTable(rows)}</details>\n`;
}

// --- Generate HTML ---
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purity Benchmarks</title>
  <style>
    :root {
      --purple: #6c5ce7;
      --purple-light: #a29bfe;
      --green: #00b894;
      --green-bg: #e6f9f3;
      --red: #d63031;
      --red-bg: #fde8e8;
      --orange: #e17055;
      --gray-50: #f8f9fa;
      --gray-100: #f1f3f5;
      --gray-200: #e9ecef;
      --gray-400: #ced4da;
      --gray-600: #868e96;
      --gray-800: #343a40;
      --gray-900: #212529;
      --radius: 10px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      max-width: 960px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem;
      background: var(--gray-50);
      color: var(--gray-900);
      line-height: 1.5;
    }

    header {
      text-align: center;
      margin-bottom: 2.5rem;
    }

    h1 {
      font-size: 2rem;
      font-weight: 800;
      color: var(--purple);
      letter-spacing: -0.02em;
    }

    header p {
      color: var(--gray-600);
      margin-top: .4rem;
      font-size: .95rem;
    }

    h2 {
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--gray-800);
      margin-bottom: 1rem;
    }

    .section { margin-bottom: 2.5rem; }

    /* Scoreboard */
    .scoreboard {
      display: flex;
      gap: .75rem;
      margin-bottom: 1.25rem;
    }

    .score-card {
      flex: 1;
      background: white;
      border-radius: var(--radius);
      padding: 1rem;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      border: 2px solid var(--gray-200);
      display: flex;
      flex-direction: column;
      gap: .2rem;
    }

    .score-card.purity { border-color: var(--purple-light); background: linear-gradient(135deg, #f8f7ff, white); }
    .score-card.solid  { border-color: #74b9ff; background: linear-gradient(135deg, #f0f8ff, white); }
    .score-card.svelte { border-color: #ff7675; background: linear-gradient(135deg, #fff5f5, white); }
    .score-card.vue    { border-color: #55efc4; background: linear-gradient(135deg, #f0fff9, white); }

    .score-num {
      font-size: 2rem;
      font-weight: 800;
      line-height: 1;
    }
    .purity .score-num { color: var(--purple); }
    .solid  .score-num { color: #0984e3; }
    .svelte .score-num { color: #d63031; }
    .vue    .score-num { color: #00b894; }

    .score-label {
      font-size: .8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--gray-600);
    }

    /* Results table */
    .results {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      background: white;
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }

    .results th {
      background: var(--gray-800);
      color: white;
      padding: .65rem .85rem;
      text-align: left;
      font-size: .78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .results th:first-child { border-radius: var(--radius) 0 0 0; }
    .results th:last-child  { border-radius: 0 var(--radius) 0 0; }

    .results td {
      padding: .55rem .85rem;
      border-bottom: 1px solid var(--gray-100);
      font-size: .88rem;
    }

    .results tbody tr:last-child td { border-bottom: none; }
    .results tbody tr:hover { background: var(--gray-50); }

    .op-name {
      font-weight: 600;
      color: var(--gray-800);
    }

    .results td.best {
      color: var(--green);
      font-weight: 700;
      background: var(--green-bg);
      font-variant-numeric: tabular-nums;
    }

    .results td.ok {
      color: var(--gray-600);
      font-variant-numeric: tabular-nums;
    }

    .results td.slow {
      color: var(--red);
      font-variant-numeric: tabular-nums;
    }

    .winner-cell {
      font-weight: 700;
    }
    .winner-cell.purity { color: var(--purple); }
    .winner-cell.solid  { color: #0984e3; }
    .winner-cell.svelte { color: #d63031; }
    .winner-cell.vue    { color: #00b894; }

    /* History */
    .history-run {
      margin-bottom: .5rem;
    }

    .history-run summary {
      cursor: pointer;
      padding: .65rem 1rem;
      background: white;
      border-radius: var(--radius);
      font-size: .88rem;
      font-weight: 500;
      color: var(--gray-800);
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      list-style: none;
      display: flex;
      align-items: center;
      gap: .5rem;
      transition: background .15s;
    }

    .history-run summary:hover { background: var(--gray-100); }

    .history-run summary::before {
      content: '\\25B6';
      font-size: .65rem;
      color: var(--gray-400);
      transition: transform .15s;
    }

    .history-run[open] summary::before { transform: rotate(90deg); }

    .history-run .scoreboard { margin-top: 1rem; }
    .history-run .results { margin-bottom: .5rem; }

    /* Footer */
    footer {
      text-align: center;
      padding-top: 1.5rem;
      border-top: 1px solid var(--gray-200);
      color: var(--gray-600);
      font-size: .82rem;
    }

    footer a { color: var(--purple); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    .methodology {
      margin-top: .75rem;
      font-size: .78rem;
      color: var(--gray-400);
    }
  </style>
</head>
<body>
  <header>
    <h1>Purity Benchmarks</h1>
    <p>Purity vs Solid vs Svelte vs Vue &mdash; automated results from headless Chromium</p>
  </header>

  <div class="section">
    <h2>Latest Run</h2>
    ${currentTable}
  </div>

  <div class="section">
    <h2>Previous Runs</h2>
    ${previousHtml || '<p style="color:var(--gray-600)">No previous runs yet.</p>'}
  </div>

  <footer>
    Trigger a new run: <a href="https://github.com/KoalaFacts/Purity/actions">Actions tab &rarr; Benchmark</a>
    <div class="methodology">Warmup: 3 iterations &middot; Measured: configurable (default 5) &middot; Metric: median &middot; Framework order randomized per operation</div>
  </footer>
</body>
</html>`;

mkdirSync('gh-pages', { recursive: true });
writeFileSync(outFile, html);
console.log(`Generated ${outFile}`);
