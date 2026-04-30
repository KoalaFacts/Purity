import { compute, each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface SpeedRow {
  category: string;
  op: string;
  purity: number;
  solid: number;
  svelte: number;
  vue: number;
  winner: string;
}

interface MemRow {
  op: string;
  purityUsed: number;
  solidUsed: number;
  svelteUsed: number;
  vueUsed: number;
  purityRetained: number;
  solidRetained: number;
  svelteRetained: number;
  vueRetained: number;
  bestCleanup: string;
}

interface HistoryRun {
  date: string;
  speed: SpeedRow[];
  memory: MemRow[];
}

interface BenchData {
  speed: SpeedRow[];
  memory: MemRow[];
  history: HistoryRun[];
}

// ---------------------------------------------------------------------------
// Load data from embedded JSON
// ---------------------------------------------------------------------------

const dataEl = document.getElementById('bench-data');
const data: BenchData = dataEl
  ? JSON.parse(dataEl.textContent || '{}')
  : { speed: [], memory: [], history: [] };

const FWS = ['Purity', 'Solid', 'Svelte', 'Vue'];

// Unicode chars as JS strings — avoids AOT compiler literal-escaping issues
const CHARS = { dash: '\u2014', lq: '\u201C', rq: '\u201D', arrow: '\u2192', dot: '\u00B7' };
const ICONS = {
  memory: '\uD83D\uDCBE',
  rendering: '\uD83C\uDFD7',
  zap: '\u26A1',
  puzzle: '\uD83E\uDDE9',
  point: '\uD83D\uDC46',
};

function getSpeedMs(r: SpeedRow, fw: string): number {
  return (r as any)[fw.toLowerCase()] as number;
}

function getMemUsed(r: MemRow, fw: string): number {
  return (r as any)[`${fw.toLowerCase()}Used`] as number;
}

function getMemRetained(r: MemRow, fw: string): number {
  return (r as any)[`${fw.toLowerCase()}Retained`] as number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countWins(rows: SpeedRow[]) {
  const wins: Record<string, number> = {};
  for (const fw of FWS) wins[fw] = 0;
  for (const r of rows) if (wins[r.winner] !== undefined) wins[r.winner]++;
  return wins;
}

function groupByCategory(rows: SpeedRow[]): { category: string; rows: SpeedRow[] }[] {
  const groups: { category: string; rows: SpeedRow[] }[] = [];
  const map = new Map<string, SpeedRow[]>();
  // Fill inherited categories
  let lastCat = '';
  for (const r of rows) {
    if (r.category) lastCat = r.category;
    const cat = r.category || lastCat;
    r.category = cat;
    if (!map.has(cat)) {
      map.set(cat, []);
      groups.push({ category: cat, rows: map.get(cat)! });
    }
    map.get(cat)!.push(r);
  }
  return groups;
}

const categoryIcons: Record<string, string> = {
  Rendering: ICONS.rendering,
  Computed: ICONS.zap,
  Components: ICONS.puzzle,
  Interaction: ICONS.point,
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ScoreCard(fw: string, count: number) {
  const cls = `score-card ${fw.toLowerCase()}`;
  return html`<div :class=${cls}>
    <span class="score-num">${String(count)}</span>
    <span class="score-label">${fw}</span>
  </div>`;
}

function Scoreboard(wins: Record<string, number>) {
  return html`<div class="scoreboard">
    ${FWS.map((fw) => ScoreCard(fw, wins[fw] || 0))}
  </div>`;
}

function MiniScoreboard(wins: Record<string, number>) {
  return html`<div class="cat-scoreboard">
    ${FWS.map((fw) => {
      const count = wins[fw] || 0;
      const cls = `cat-score ${fw.toLowerCase()}${count > 0 ? ' has-wins' : ''}`;
      return html`<span :class=${cls}>${fw} ${String(count)}</span>`;
    })}
  </div>`;
}

// Table rows built with DOM API because HTML spec strips comment placeholders
// from <tr> context. This is a known Purity compiler limitation.
function speedRow(r: SpeedRow) {
  const vals = FWS.map((fw) => getSpeedMs(r, fw)).filter((v) => v != null && !Number.isNaN(v));
  const best = vals.length ? Math.min(...vals) : 0;
  const tr = document.createElement('tr');

  const opTd = document.createElement('td');
  opTd.className = 'op-name';
  opTd.textContent = r.op;
  tr.appendChild(opTd);

  for (const fw of FWS) {
    const ms = getSpeedMs(r, fw);
    const td = document.createElement('td');
    if (ms == null || Number.isNaN(ms)) {
      td.className = 'ok';
      td.textContent = '\u2014';
    } else {
      const isBest = ms === best || fw === r.winner;
      const ratio = best > 0 ? ms / best : 1;
      td.className = isBest ? 'best' : ratio > 2 ? 'slow' : 'ok';
      td.textContent = `${ms.toFixed(1)}ms`;
    }
    tr.appendChild(td);
  }

  const winTd = document.createElement('td');
  winTd.className = `winner-cell ${r.winner.toLowerCase()}`;
  winTd.textContent = r.winner;
  tr.appendChild(winTd);
  return tr;
}

function SpeedTable(rows: SpeedRow[]) {
  const table = document.createElement('table');
  table.className = 'results';
  const thead = table.createTHead();
  const hRow = thead.insertRow();
  const addTh = (text: string) => {
    const th = document.createElement('th');
    th.textContent = text;
    hRow.appendChild(th);
  };
  addTh('Operation');
  for (const fw of FWS) addTh(fw);
  addTh('Winner');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tbody.appendChild(
    each(
      rows,
      (r: () => (typeof rows)[number]) => speedRow(r()),
      (r) => r.op,
    ),
  );
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  wrapper.appendChild(table);
  return wrapper;
}

function addMemTd(tr: HTMLTableRowElement, val: number, best: number, isRetained: boolean) {
  const td = document.createElement('td');
  if (val == null || Number.isNaN(val)) {
    td.className = 'ok';
    td.textContent = '\u2014';
  } else {
    const cmp = isRetained ? Math.abs(val) : val;
    td.className = cmp === best ? 'best' : cmp > best * 2 ? 'slow' : 'ok';
    td.textContent = `${val.toFixed(1)}MB`;
  }
  tr.appendChild(td);
}

function memRow(r: MemRow) {
  const usedVals = FWS.map((fw) => getMemUsed(r, fw)).filter((v) => v != null && !Number.isNaN(v));
  const bestUsed = usedVals.length ? Math.min(...usedVals) : 0;
  const retVals = FWS.map((fw) => getMemRetained(r, fw)).filter(
    (v) => v != null && !Number.isNaN(v),
  );
  const bestRet = retVals.length ? Math.min(...retVals.map((v) => Math.abs(v))) : 0;

  const tr = document.createElement('tr');
  const opTd = document.createElement('td');
  opTd.className = 'op-name';
  opTd.textContent = r.op;
  tr.appendChild(opTd);
  for (const fw of FWS) addMemTd(tr, getMemUsed(r, fw), bestUsed, false);
  for (const fw of FWS) addMemTd(tr, getMemRetained(r, fw), bestRet, true);
  const winTd = document.createElement('td');
  winTd.className = `winner-cell ${r.bestCleanup.toLowerCase()}`;
  winTd.textContent = r.bestCleanup;
  tr.appendChild(winTd);
  return tr;
}

function MemoryTable(rows: MemRow[]) {
  if (!rows.length) return html`<p class="empty">No memory data available.</p>`;

  const usedWins: Record<string, number> = {};
  const cleanupWins: Record<string, number> = {};
  for (const fw of FWS) {
    usedWins[fw] = 0;
    cleanupWins[fw] = 0;
  }
  for (const r of rows) {
    const usedVals = FWS.map((fw) => ({ fw, v: getMemUsed(r, fw) })).filter(
      (x) => !Number.isNaN(x.v),
    );
    if (usedVals.length) usedWins[usedVals.reduce((a, b) => (a.v < b.v ? a : b)).fw]++;
    if (cleanupWins[r.bestCleanup] !== undefined) cleanupWins[r.bestCleanup]++;
  }

  // Build memory table header with DOM API (table-context limitation)
  const table = document.createElement('table');
  table.className = 'results';
  const thead = table.createTHead();
  const row1 = thead.insertRow();
  const addTh = (row: HTMLTableRowElement, text: string, attrs?: Record<string, string>) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) th.setAttribute(k, v);
    row.appendChild(th);
  };
  addTh(row1, 'Operation', { rowspan: '2' });
  addTh(row1, 'Heap Used (after create)', { colspan: '4' });
  addTh(row1, 'Heap Retained (after destroy)', { colspan: '4' });
  addTh(row1, 'Best Cleanup', { rowspan: '2' });
  const row2 = thead.insertRow();
  for (const fw of FWS) addTh(row2, fw);
  for (const fw of FWS) addTh(row2, fw);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tbody.appendChild(
    each(
      rows,
      (r: () => (typeof rows)[number]) => memRow(r()),
      (r) => r.op,
    ),
  );

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-scroll';
  tableWrapper.appendChild(table);

  return html`<div>
    <div class="mem-scores">
      <div class="mem-score-group">
        <div class="mem-score-label">Lowest Heap</div>
        ${MiniScoreboard(usedWins)}
      </div>
      <div class="mem-score-group">
        <div class="mem-score-label">Best Cleanup</div>
        ${MiniScoreboard(cleanupWins)}
      </div>
    </div>
    ${tableWrapper}
  </div>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function applyGlobalStyles() {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --purple: #6c5ce7; --purple-light: #a29bfe;
      --green: #00b894; --green-bg: #e6f9f3;
      --red: #d63031; --red-bg: #fde8e8;
      --gray-50: #f8f9fa; --gray-100: #f1f3f5; --gray-200: #e9ecef;
      --gray-400: #ced4da; --gray-600: #868e96; --gray-800: #343a40; --gray-900: #212529;
      --radius: 10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      max-width: 1020px; margin: 0 auto; padding: 2.5rem 1.5rem;
      background: var(--gray-50); color: var(--gray-900); line-height: 1.5;
    }
    header { text-align: center; margin-bottom: 2.5rem; }
    h1 { font-size: 2rem; font-weight: 800; color: var(--purple); letter-spacing: -0.02em; }
    header p { color: var(--gray-600); margin-top: .4rem; font-size: .95rem; }
    h2 { font-size: 1.15rem; font-weight: 700; color: var(--gray-800); margin-bottom: 1rem; }
    .section { margin-bottom: 2.5rem; }
    .empty { color: var(--gray-600); font-size: .9rem; }

    /* Scoreboard */
    .scoreboard { display: flex; gap: .75rem; margin-bottom: 1.25rem; }
    .score-card {
      flex: 1; background: white; border-radius: var(--radius); padding: 1rem;
      text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.06);
      border: 2px solid var(--gray-200); display: flex; flex-direction: column; gap: .2rem;
    }
    .score-card.purity { border-color: var(--purple-light); background: linear-gradient(135deg, #f8f7ff, white); }
    .score-card.solid  { border-color: #74b9ff; background: linear-gradient(135deg, #f0f8ff, white); }
    .score-card.svelte { border-color: #ff7675; background: linear-gradient(135deg, #fff5f5, white); }
    .score-card.vue    { border-color: #55efc4; background: linear-gradient(135deg, #f0fff9, white); }
    .score-num { font-size: 2rem; font-weight: 800; line-height: 1; }
    .purity .score-num { color: var(--purple); }
    .solid  .score-num { color: #0984e3; }
    .svelte .score-num { color: #d63031; }
    .vue    .score-num { color: #00b894; }
    .score-label { font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-600); }

    /* Category navigation */
    .cat-nav { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1.5rem; }
    .cat-pill {
      display: inline-block; padding: .35rem .75rem; background: white;
      border: 1px solid var(--gray-200); border-radius: 20px; font-size: .8rem;
      font-weight: 500; color: var(--gray-600); text-decoration: none; cursor: pointer; transition: all .15s;
    }
    .cat-pill:hover { background: var(--gray-100); color: var(--gray-800); border-color: var(--gray-400); }
    .cat-pill.active { background: var(--gray-800); color: white; border-color: var(--gray-800); }

    /* Category sections */
    .cat-section { margin-bottom: 1.75rem; scroll-margin-top: 1rem; }
    .cat-heading {
      font-size: 1.05rem; font-weight: 700; color: var(--gray-800);
      margin-bottom: .5rem; display: flex; align-items: center; gap: .5rem;
    }
    .cat-count {
      font-size: .72rem; font-weight: 500; color: var(--gray-400);
      background: var(--gray-100); padding: .15rem .5rem; border-radius: 10px;
    }
    .cat-scoreboard { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .6rem; }
    .cat-score {
      display: inline-flex; align-items: center; gap: .3rem; padding: .2rem .55rem;
      border-radius: 6px; font-size: .72rem; font-weight: 600;
      background: var(--gray-100); color: var(--gray-400);
    }
    .cat-score.has-wins { color: var(--gray-800); }
    .cat-score.purity.has-wins { background: #f0efff; color: var(--purple); }
    .cat-score.solid.has-wins  { background: #e8f4fd; color: #0984e3; }
    .cat-score.svelte.has-wins { background: #fde8e8; color: #d63031; }
    .cat-score.vue.has-wins    { background: #e0f8f1; color: #00b894; }

    /* Memory scores */
    .mem-scores { display: flex; gap: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .mem-score-group { flex: 1; min-width: 200px; }
    .mem-score-label {
      font-size: .72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--gray-400); margin-bottom: .3rem;
    }

    /* Results table */
    .results {
      width: 100%; border-collapse: separate; border-spacing: 0;
      background: white; border-radius: var(--radius); overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    .results th {
      background: var(--gray-800); color: white; padding: .65rem .85rem;
      text-align: left; font-size: .78rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em;
    }
    .results th:first-child { border-radius: var(--radius) 0 0 0; }
    .results th:last-child  { border-radius: 0 var(--radius) 0 0; }
    .results td { padding: .55rem .85rem; border-bottom: 1px solid var(--gray-100); font-size: .88rem; }
    .results tbody tr:last-child td { border-bottom: none; }
    .results tbody tr:hover { background: var(--gray-50); }
    .op-name { font-weight: 600; color: var(--gray-800); }
    .results td.best { color: var(--green); font-weight: 700; background: var(--green-bg); font-variant-numeric: tabular-nums; }
    .results td.ok { color: var(--gray-600); font-variant-numeric: tabular-nums; }
    .results td.slow { color: var(--red); font-variant-numeric: tabular-nums; }
    .winner-cell { font-weight: 700; }
    .winner-cell.purity { color: var(--purple); }
    .winner-cell.solid  { color: #0984e3; }
    .winner-cell.svelte { color: #d63031; }
    .winner-cell.vue    { color: #00b894; }

    /* History */
    .history-run { margin-bottom: .5rem; }
    .history-run summary {
      cursor: pointer; padding: .65rem 1rem; background: white;
      border-radius: var(--radius); font-size: .88rem; font-weight: 500;
      color: var(--gray-800); box-shadow: 0 1px 3px rgba(0,0,0,.06);
      list-style: none; display: flex; align-items: center; gap: .5rem; transition: background .15s;
    }
    .history-run summary:hover { background: var(--gray-100); }
    .history-run summary::before { content: '\\25B6'; font-size: .65rem; color: var(--gray-400); transition: transform .15s; }
    .history-run[open] summary::before { transform: rotate(90deg); }
    .history-run .scoreboard { margin-top: 1rem; }
    .history-run .results { margin-bottom: .5rem; }

    footer {
      text-align: center; padding-top: 1.5rem; border-top: 1px solid var(--gray-200);
      color: var(--gray-600); font-size: .82rem;
    }
    footer a { color: var(--purple); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
    .methodology { margin-top: .75rem; font-size: .78rem; color: var(--gray-400); }
    .mem-note { color: var(--gray-600); font-size: .85rem; margin-bottom: 1rem; }
    .mem-note code { background: var(--gray-100); padding: .1rem .3rem; border-radius: 3px; font-size: .8rem; }

    /* Table scroll wrapper — added by JS for responsive tables */
    .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

    /* Large tablets / small laptops (≤ 900px) */
    @media (max-width: 900px) {
      body { padding: 2rem 1rem; }
      h1 { font-size: 1.75rem; }

      .results th { padding: .55rem .65rem; font-size: .72rem; }
      .results td { padding: .5rem .65rem; font-size: .84rem; }
    }

    /* Tablets (≤ 768px) */
    @media (max-width: 768px) {
      body { padding: 1.5rem 1rem; }
      h1 { font-size: 1.6rem; }
      header p { font-size: .88rem; }
      h2 { font-size: 1.05rem; }

      .scoreboard { gap: .5rem; }
      .score-card { padding: .8rem .5rem; }
      .score-num { font-size: 1.75rem; }

      .results { min-width: 580px; }
      .results th { padding: .5rem .55rem; font-size: .7rem; }
      .results td { padding: .45rem .55rem; font-size: .82rem; }

      .mem-scores { gap: 1rem; }
      .methodology { font-size: .72rem; }
    }

    /* Small phones (≤ 480px) */
    @media (max-width: 480px) {
      body { padding: 1rem .5rem; }
      h1 { font-size: 1.3rem; }
      header p { font-size: .78rem; }
      h2 { font-size: .95rem; }
      .section { margin-bottom: 1.75rem; }

      /* Scoreboard: 2x2 grid */
      .scoreboard { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
      .score-card { padding: .6rem .4rem; }
      .score-num { font-size: 1.3rem; }
      .score-label { font-size: .65rem; }

      /* Tables: tighter cells */
      .results { min-width: 520px; }
      .results th { padding: .4rem .4rem; font-size: .65rem; }
      .results td { padding: .35rem .4rem; font-size: .75rem; }

      /* Category pills */
      .cat-nav { gap: .25rem; }
      .cat-pill { padding: .25rem .5rem; font-size: .68rem; }

      /* Category sections */
      .cat-heading { font-size: .92rem; }
      .cat-count { font-size: .65rem; }
      .cat-score { font-size: .65rem; padding: .15rem .4rem; }

      /* Memory scores stack */
      .mem-scores { flex-direction: column; gap: .6rem; }
      .mem-note { font-size: .78rem; }

      /* History */
      .history-run summary { padding: .45rem .6rem; font-size: .78rem; }

      /* Footer */
      footer { font-size: .72rem; padding-top: 1rem; }
      .methodology { font-size: .65rem; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

// Extracted sub-components to keep templates simple for AOT
function CategorySection(group: { category: string; rows: SpeedRow[] }) {
  const catWins = countWins(group.rows);
  const icon = categoryIcons[group.category] || '';
  const sectionId = `cat-${group.category.toLowerCase()}`;
  const opCount = String(group.rows.length);
  return html`<div class="cat-section" id="${sectionId}">
    <h3 class="cat-heading">${icon} ${group.category} <span class="cat-count">${opCount} ops</span></h3>
    ${MiniScoreboard(catWins)}
    ${SpeedTable(group.rows)}
  </div>`;
}

function CatPill(label: string, icon: string, activeCategory: any) {
  const pillClass = compute(() => `cat-pill${activeCategory() === label ? ' active' : ''}`);
  return html`<span :class=${pillClass} @click=${() => activeCategory(label)}>${icon} ${label}</span>`;
}

function AllPill(activeCategory: any) {
  const pillClass = compute(() => `cat-pill${activeCategory() === null ? ' active' : ''}`);
  return html`<span :class=${pillClass} @click=${() => activeCategory(null)}>All</span>`;
}

function HistorySection(run: HistoryRun) {
  const wins = countWins(run.speed);
  return html`<details class="history-run">
    <summary>${run.date}</summary>
    ${Scoreboard(wins)}
    ${SpeedTable(run.speed)}
    ${run.memory.length ? HistoryMemory(run.memory) : ''}
  </details>`;
}

function HistoryMemory(rows: MemRow[]) {
  return html`<div>
    <h3 style="margin-top:1rem;font-size:.95rem">Memory</h3>
    ${MemoryTable(rows)}
  </div>`;
}

function MemorySection() {
  if (!data.memory.length) return document.createDocumentFragment();
  return html`<div class="section" id="cat-memory">
    <h2>${ICONS.memory} Memory</h2>
    <p class="mem-note">Heap delta measured via <code>performance.memory</code> with forced GC.
      ${CHARS.lq}Used${CHARS.rq} = heap after create. ${CHARS.lq}Retained${CHARS.rq} = heap after destroy (closer to 0 = better cleanup).</p>
    ${MemoryTable(data.memory)}
  </div>`;
}

function PreviousRunsSection() {
  if (!data.history.length) {
    return html`<div class="section">
      <h2>Previous Runs</h2>
      <p class="empty">No previous runs yet.</p>
    </div>`;
  }
  return html`<div class="section">
    <h2>Previous Runs</h2>
    ${data.history.map((run) => HistorySection(run))}
  </div>`;
}

function App() {
  applyGlobalStyles();

  const groups = groupByCategory(data.speed);
  const totalWins = countWins(data.speed);
  const activeCategory = state<string | null>(null);

  const visibleGroups = compute(() => {
    const active = activeCategory();
    if (!active) return groups;
    return groups.filter((g) => g.category === active);
  });

  const catPills = groups.map((g) =>
    CatPill(g.category, categoryIcons[g.category] || '', activeCategory),
  );

  return html`
    <header>
      <h1>Purity Benchmarks</h1>
      <p>Purity vs Solid vs Svelte vs Vue ${CHARS.dash} automated results from headless Chromium</p>
    </header>

    <div class="section">
      <h2>Latest Run</h2>
      ${Scoreboard(totalWins)}
      <div class="cat-nav">
        ${AllPill(activeCategory)}
        ${catPills}
      </div>
      ${each(
        () => visibleGroups(),
        (g: () => ReturnType<typeof visibleGroups>[number]) => CategorySection(g()),
        (g) => g.category,
      )}
    </div>

    ${MemorySection()}
    ${PreviousRunsSection()}

    <footer>
      Trigger a new run: <a href="https://github.com/KoalaFacts/Purity/actions">Actions tab ${CHARS.arrow} Benchmark</a>
      <div class="methodology">Warmup: 3 iterations ${CHARS.dot} Measured: 7 (configurable) ${CHARS.dot} Drop: fastest 1 + slowest 1 ${CHARS.dot} Metric: trimmed median ${CHARS.dot} Framework order randomized per operation</div>
      <div class="methodology" style="margin-top:.3rem">Built with <a href="https://github.com/KoalaFacts/Purity">Purity</a> ${CHARS.dash} 17 functions, 6 kB gzipped</div>
    </footer>
  `;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(App, document.getElementById('app')!);
