import { compute, each, html, mount, onMount, state } from "@purityjs/core";

// ---------------------------------------------------------------------------
// Data types (unchanged — consumed from generate-pages.ts JSON payload)
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
// Load embedded JSON
// ---------------------------------------------------------------------------

const dataEl = document.getElementById("bench-data");
const data: BenchData = dataEl
  ? JSON.parse(dataEl.textContent || "{}")
  : { speed: [], memory: [], history: [] };

const FWS = ["Purity", "Solid", "Svelte", "Vue"] as const;
const FW_KEYS = ["purity", "solid", "svelte", "vue"] as const;

const CHARS = { dash: "\u2014", lq: "\u201C", rq: "\u201D", arrow: "\u2192", dot: "\u00B7" };

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

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
  let lastCat = "";
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

function fmtMs(ms: number): string {
  if (ms == null || Number.isNaN(ms)) return CHARS.dash;
  return ms < 10 ? `${ms.toFixed(2)}ms` : ms < 100 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`;
}

// ---------------------------------------------------------------------------
// Bar Chart (DOM API — width is computed per-row)
// ---------------------------------------------------------------------------

function BarChart(rows: SpeedRow[]): HTMLElement {
  const chart = document.createElement("div");
  chart.className = "chart";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const vals: { fw: string; key: string; ms: number }[] = [];
    for (let j = 0; j < 4; j++) {
      const ms = getSpeedMs(r, FWS[j]);
      if (ms != null && !Number.isNaN(ms)) vals.push({ fw: FWS[j], key: FW_KEYS[j], ms });
    }
    if (!vals.length) continue;

    const maxVal = Math.max(...vals.map((v) => v.ms));
    const minVal = Math.min(...vals.map((v) => v.ms));

    const group = document.createElement("div");
    group.className = "chart-group";

    const label = document.createElement("div");
    label.className = "chart-label";
    label.textContent = r.op;
    group.appendChild(label);

    const tracks = document.createElement("div");
    tracks.className = "chart-tracks";

    for (let j = 0; j < vals.length; j++) {
      const { fw, key, ms } = vals[j];
      const pct = maxVal > 0 ? (ms / maxVal) * 100 : 0;
      const isBest = ms === minVal;

      const row = document.createElement("div");
      row.className = `chart-bar ${key}${isBest ? " is-best" : ""}`;

      const fwLabel = document.createElement("span");
      fwLabel.className = "chart-fw";
      fwLabel.textContent = fw.slice(0, 2);

      const track = document.createElement("div");
      track.className = "chart-track";

      const fill = document.createElement("div");
      fill.className = "chart-fill";
      fill.style.width = `${Math.max(pct, 3)}%`;

      track.appendChild(fill);

      const val = document.createElement("span");
      val.className = "chart-ms";
      val.textContent = fmtMs(ms);

      row.appendChild(fwLabel);
      row.appendChild(track);
      row.appendChild(val);
      tracks.appendChild(row);
    }

    group.appendChild(tracks);
    chart.appendChild(group);
  }

  return chart;
}

// ---------------------------------------------------------------------------
// Tables (DOM API for <tr> — Purity compiler limitation)
// ---------------------------------------------------------------------------

function speedRow(r: SpeedRow): HTMLTableRowElement {
  const vals = FWS.map((fw) => getSpeedMs(r, fw)).filter((v) => v != null && !Number.isNaN(v));
  const best = vals.length ? Math.min(...vals) : 0;
  const tr = document.createElement("tr");

  const opTd = document.createElement("td");
  opTd.className = "cell-op";
  opTd.textContent = r.op;
  tr.appendChild(opTd);

  for (const fw of FWS) {
    const ms = getSpeedMs(r, fw);
    const td = document.createElement("td");
    td.className = "cell-num";
    if (ms == null || Number.isNaN(ms)) {
      td.classList.add("is-na");
      td.textContent = CHARS.dash;
    } else {
      const isBest = ms === best || fw === r.winner;
      const ratio = best > 0 ? ms / best : 1;
      if (isBest) td.classList.add("is-best");
      else if (ratio > 2) td.classList.add("is-slow");
      td.textContent = fmtMs(ms);
    }
    tr.appendChild(td);
  }

  const winTd = document.createElement("td");
  winTd.className = "cell-winner";
  const badge = document.createElement("span");
  badge.className = `winner-badge ${r.winner.toLowerCase()}`;
  badge.textContent = r.winner;
  winTd.appendChild(badge);
  tr.appendChild(winTd);
  return tr;
}

function SpeedTable(rows: SpeedRow[]): HTMLElement {
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = table.createTHead();
  const hRow = thead.insertRow();
  const headers = ["Operation", ...FWS, "Winner"];
  for (let i = 0; i < headers.length; i++) {
    const th = document.createElement("th");
    th.textContent = headers[i];
    if (i > 0 && i < 5) th.className = "th-num";
    if (i === 5) th.className = "th-winner";
    hRow.appendChild(th);
  }
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tbody.appendChild(
    each(
      rows,
      (r) => speedRow(r),
      (r) => r.op,
    ),
  );
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  wrapper.appendChild(table);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Memory table
// ---------------------------------------------------------------------------

function addMemTd(tr: HTMLTableRowElement, val: number, best: number, isRetained: boolean) {
  const td = document.createElement("td");
  td.className = "cell-num";
  if (val == null || Number.isNaN(val)) {
    td.classList.add("is-na");
    td.textContent = CHARS.dash;
  } else {
    const cmp = isRetained ? Math.abs(val) : val;
    if (cmp === best) td.classList.add("is-best");
    else if (cmp > best * 2) td.classList.add("is-slow");
    td.textContent = `${val.toFixed(1)}MB`;
  }
  tr.appendChild(td);
}

function memRow(r: MemRow): HTMLTableRowElement {
  const usedVals = FWS.map((fw) => getMemUsed(r, fw)).filter((v) => v != null && !Number.isNaN(v));
  const bestUsed = usedVals.length ? Math.min(...usedVals) : 0;
  const retVals = FWS.map((fw) => getMemRetained(r, fw)).filter(
    (v) => v != null && !Number.isNaN(v),
  );
  const bestRet = retVals.length ? Math.min(...retVals.map((v) => Math.abs(v))) : 0;

  const tr = document.createElement("tr");
  const opTd = document.createElement("td");
  opTd.className = "cell-op";
  opTd.textContent = r.op;
  tr.appendChild(opTd);
  for (const fw of FWS) addMemTd(tr, getMemUsed(r, fw), bestUsed, false);
  for (const fw of FWS) addMemTd(tr, getMemRetained(r, fw), bestRet, true);
  const winTd = document.createElement("td");
  winTd.className = "cell-winner";
  const badge = document.createElement("span");
  badge.className = `winner-badge ${r.bestCleanup.toLowerCase()}`;
  badge.textContent = r.bestCleanup;
  winTd.appendChild(badge);
  tr.appendChild(winTd);
  return tr;
}

function MemoryTable(rows: MemRow[]): HTMLElement {
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "empty-msg";
    p.textContent = "No memory data available.";
    return p;
  }

  const table = document.createElement("table");
  table.className = "data-table";
  const thead = table.createTHead();
  const row1 = thead.insertRow();
  const addTh = (row: HTMLTableRowElement, text: string, attrs?: Record<string, string>) => {
    const th = document.createElement("th");
    th.textContent = text;
    if (attrs) for (const [k, v] of Object.entries(attrs)) th.setAttribute(k, v);
    row.appendChild(th);
  };
  addTh(row1, "Operation", { rowspan: "2" });
  addTh(row1, "Heap Used (after create)", { colspan: "4", class: "th-group" });
  addTh(row1, "Heap Retained (after destroy)", { colspan: "4", class: "th-group" });
  addTh(row1, "Best Cleanup", { rowspan: "2" });
  const row2 = thead.insertRow();
  for (const fw of FWS) addTh(row2, fw, { class: "th-num" });
  for (const fw of FWS) addTh(row2, fw, { class: "th-num" });
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  tbody.appendChild(
    each(
      rows,
      (r) => memRow(r),
      (r) => r.op,
    ),
  );
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  wrapper.appendChild(table);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Score components
// ---------------------------------------------------------------------------

function ScoreCard(fw: string, count: number) {
  const key = fw.toLowerCase();
  return html`<div class="score-card">
    <div class="score-accent ${key}"></div>
    <div class="score-body">
      <span class="score-num ${key}">${String(count)}</span>
      <span class="score-meta"><span class="score-fw">${fw}</span> wins</span>
    </div>
  </div>`;
}

function Scoreboard(wins: Record<string, number>) {
  return html`<div class="scoreboard">${FWS.map((fw) => ScoreCard(fw, wins[fw] || 0))}</div>`;
}

function MiniScoreboard(wins: Record<string, number>) {
  return html`<div class="mini-scores">
    ${FWS.map((fw) => {
      const count = wins[fw] || 0;
      const cls = `mini-score ${fw.toLowerCase()}${count > 0 ? " has-wins" : ""}`;
      return html`<span :class=${cls}>${fw} ${String(count)}</span>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Category section
// ---------------------------------------------------------------------------

function CategorySection(group: { category: string; rows: SpeedRow[] }) {
  const catWins = countWins(group.rows);
  const sectionId = `cat-${group.category.toLowerCase()}`;
  const opCount = String(group.rows.length);
  const chart = BarChart(group.rows);

  return html`<section class="category" id="${sectionId}">
    <div class="cat-header">
      <h2 class="cat-title">${group.category}</h2>
      <span class="cat-badge">${opCount} tests</span>
    </div>
    ${MiniScoreboard(catWins)} ${chart}
    <details class="table-toggle">
      <summary>View detailed table</summary>
      ${SpeedTable(group.rows)}
    </details>
  </section>`;
}

// ---------------------------------------------------------------------------
// Memory section
// ---------------------------------------------------------------------------

function MemorySection() {
  if (!data.memory.length) return document.createDocumentFragment();

  const usedWins: Record<string, number> = {};
  const cleanupWins: Record<string, number> = {};
  for (const fw of FWS) {
    usedWins[fw] = 0;
    cleanupWins[fw] = 0;
  }
  for (const r of data.memory) {
    const usedVals = FWS.map((fw) => ({ fw, v: getMemUsed(r, fw) })).filter(
      (x) => !Number.isNaN(x.v),
    );
    if (usedVals.length) usedWins[usedVals.reduce((a, b) => (a.v < b.v ? a : b)).fw]++;
    if (cleanupWins[r.bestCleanup] !== undefined) cleanupWins[r.bestCleanup]++;
  }

  return html`<section class="category" id="cat-memory">
    <div class="cat-header">
      <h2 class="cat-title">Memory</h2>
      <span class="cat-badge">${String(data.memory.length)} tests</span>
    </div>
    <div class="mem-metrics">
      <div class="mem-metric">
        <div class="mem-metric-label">Lowest Heap</div>
        ${MiniScoreboard(usedWins)}
      </div>
      <div class="mem-metric">
        <div class="mem-metric-label">Best Cleanup</div>
        ${MiniScoreboard(cleanupWins)}
      </div>
    </div>
    <p class="mem-note">
      Heap delta via <code>performance.memory</code> with forced GC. ${CHARS.lq}Used${CHARS.rq} =
      after create, ${CHARS.lq}Retained${CHARS.rq} = after destroy (closer to 0 = better).
    </p>
    ${MemoryTable(data.memory)}
  </section>`;
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------

function HistorySection(run: HistoryRun) {
  const wins = countWins(run.speed);
  const winSummary = FWS.map((fw) => `${fw} ${wins[fw] || 0}`).join("  ");
  return html`<details class="history-item">
    <summary>
      <span class="history-date">${run.date}</span><span class="history-wins">${winSummary}</span>
    </summary>
    <div class="history-body">
      ${Scoreboard(wins)} ${SpeedTable(run.speed)}
      ${run.memory.length ? MemoryTable(run.memory) : ""}
    </div>
  </details>`;
}

function PreviousRunsSection() {
  if (!data.history.length) return document.createDocumentFragment();
  return html`<section class="category" id="section-history">
    <div class="cat-header">
      <h2 class="cat-title">Previous Runs</h2>
    </div>
    ${data.history.map((run) => HistorySection(run))}
  </section>`;
}

// ---------------------------------------------------------------------------
// Scroll-spy navigation
// ---------------------------------------------------------------------------

function setupScrollSpy(activePill: (val: string | null) => void) {
  const sections = document.querySelectorAll('.category[id^="cat-"]');
  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          const id = entries[i].target.id;
          activePill(id === "section-history" ? null : id.replace("cat-", ""));
        }
      }
    },
    { rootMargin: "-72px 0px -65% 0px" },
  );

  for (let i = 0; i < sections.length; i++) observer.observe(sections[i]);
}

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function applyGlobalStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f8fafc; color: #0f172a; line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.85em; }

    .page { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem 3rem; }

    /* ── Hero ─────────────────────────────────── */
    .hero {
      text-align: center; padding: 3.5rem 0 2rem;
    }
    .hero-title {
      font-size: 2.75rem; font-weight: 800; letter-spacing: -0.04em;
      color: #0f172a; line-height: 1.1;
    }
    .hero-title .accent { color: #7c3aed; }
    .hero-sub {
      color: #64748b; font-size: 1rem; margin-top: 0.5rem; font-weight: 400;
    }

    /* ── Scoreboard ──────────────────────────── */
    .scoreboard {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      margin: 2rem 0 1.5rem;
    }
    .score-card {
      background: #fff; border-radius: 12px; overflow: hidden;
      display: flex; box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.04);
      transition: box-shadow .2s, transform .2s;
    }
    .score-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.06); transform: translateY(-1px); }
    .score-accent { width: 4px; flex-shrink: 0; }
    .score-accent.purity { background: #7c3aed; }
    .score-accent.solid  { background: #2563eb; }
    .score-accent.svelte { background: #dc2626; }
    .score-accent.vue    { background: #16a34a; }
    .score-body { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 2px; }
    .score-num {
      font-family: 'JetBrains Mono', monospace; font-size: 2rem; font-weight: 700;
      line-height: 1; font-variant-numeric: tabular-nums;
    }
    .score-num.purity { color: #7c3aed; }
    .score-num.solid  { color: #2563eb; }
    .score-num.svelte { color: #dc2626; }
    .score-num.vue    { color: #16a34a; }
    .score-meta { font-size: 0.75rem; color: #94a3b8; font-weight: 500; letter-spacing: 0.02em; }
    .score-fw { font-weight: 700; color: #64748b; }

    /* ── Sticky Nav ──────────────────────────── */
    .sticky-nav {
      position: sticky; top: 0; z-index: 100;
      background: rgba(248,250,252,.82);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid #e2e8f0;
      padding: 0.65rem 0; margin: 0 -1.5rem; padding-left: 1.5rem; padding-right: 1.5rem;
    }
    .nav-pills {
      display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
      -ms-overflow-style: none; max-width: 1100px; margin: 0 auto;
    }
    .nav-pills::-webkit-scrollbar { display: none; }
    .nav-pill {
      display: inline-flex; align-items: center; padding: 6px 14px;
      border-radius: 8px; font-size: 0.8rem; font-weight: 600;
      color: #64748b; background: transparent; border: none; cursor: pointer;
      white-space: nowrap; transition: all .15s; font-family: inherit;
    }
    .nav-pill:hover { background: #f1f5f9; color: #334155; }
    .nav-pill.active { background: #0f172a; color: #fff; }

    /* ── Category section ────────────────────── */
    .category {
      margin-top: 2.5rem; scroll-margin-top: 4rem;
    }
    .cat-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 0.5rem; }
    .cat-title { font-size: 1.3rem; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
    .cat-badge {
      font-size: 0.7rem; font-weight: 600; color: #94a3b8;
      background: #f1f5f9; padding: 3px 10px; border-radius: 20px;
    }

    /* ── Mini scoreboard ─────────────────────── */
    .mini-scores { display: flex; gap: 6px; margin-bottom: 1rem; flex-wrap: wrap; }
    .mini-score {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
      border-radius: 6px; font-size: 0.72rem; font-weight: 600;
      background: #f1f5f9; color: #94a3b8;
    }
    .mini-score.has-wins { color: #334155; }
    .mini-score.purity.has-wins { background: #ede9fe; color: #7c3aed; }
    .mini-score.solid.has-wins  { background: #dbeafe; color: #2563eb; }
    .mini-score.svelte.has-wins { background: #fee2e2; color: #dc2626; }
    .mini-score.vue.has-wins    { background: #dcfce7; color: #16a34a; }

    /* ── Bar chart ───────────────────────────── */
    .chart { margin-bottom: 1.25rem; }
    .chart-group {
      padding: 10px 0; border-bottom: 1px solid #f1f5f9;
    }
    .chart-group:last-child { border-bottom: none; }
    .chart-label {
      font-size: 0.78rem; font-weight: 600; color: #334155;
      margin-bottom: 6px;
    }
    .chart-tracks { display: flex; flex-direction: column; gap: 3px; }
    .chart-bar {
      display: flex; align-items: center; gap: 6px; height: 22px;
    }
    .chart-fw {
      width: 18px; font-size: 0.65rem; font-weight: 700; color: #94a3b8;
      text-transform: uppercase; flex-shrink: 0; text-align: right;
      font-family: 'JetBrains Mono', monospace;
    }
    .chart-track {
      flex: 1; height: 14px; background: #f1f5f9; border-radius: 4px;
      overflow: hidden; position: relative;
    }
    .chart-fill {
      height: 100%; border-radius: 4px;
      transition: width .4s cubic-bezier(.16,1,.3,1);
    }
    .chart-bar.purity .chart-fill { background: rgba(124,58,237,.18); }
    .chart-bar.solid  .chart-fill { background: rgba(37,99,235,.18); }
    .chart-bar.svelte .chart-fill { background: rgba(220,38,38,.18); }
    .chart-bar.vue    .chart-fill { background: rgba(22,163,74,.18); }
    .chart-bar.purity.is-best .chart-fill { background: rgba(124,58,237,.55); }
    .chart-bar.solid.is-best  .chart-fill { background: rgba(37,99,235,.55); }
    .chart-bar.svelte.is-best .chart-fill { background: rgba(220,38,38,.55); }
    .chart-bar.vue.is-best    .chart-fill { background: rgba(22,163,74,.55); }
    .chart-bar.is-best .chart-fw { color: #334155; }
    .chart-ms {
      font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 500;
      color: #94a3b8; width: 56px; text-align: right; flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .chart-bar.is-best .chart-ms { color: #0f172a; font-weight: 700; }

    /* ── Table toggle ────────────────────────── */
    .table-toggle { margin-top: 0.75rem; }
    .table-toggle summary {
      cursor: pointer; font-size: 0.78rem; font-weight: 600; color: #7c3aed;
      list-style: none; display: inline-flex; align-items: center; gap: 4px;
      padding: 6px 0; transition: color .15s;
    }
    .table-toggle summary:hover { color: #6d28d9; }
    .table-toggle summary::before {
      content: '\\25B8'; font-size: 0.7rem; transition: transform .15s;
    }
    .table-toggle[open] summary::before { transform: rotate(90deg); }
    .table-toggle .table-wrap { margin-top: 0.75rem; }

    /* ── Data table ──────────────────────────── */
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .data-table {
      width: 100%; border-collapse: collapse; background: #fff;
      border-radius: 10px; overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.05);
    }
    .data-table th {
      padding: 10px 14px; text-align: left;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #64748b; background: #f8fafc;
      border-bottom: 2px solid #e2e8f0;
    }
    .data-table th.th-num { text-align: right; }
    .data-table th.th-winner { text-align: center; }
    .data-table th.th-group { text-align: center; font-size: 0.65rem; color: #94a3b8; }
    .data-table td { padding: 8px 14px; border-bottom: 1px solid #f1f5f9; font-size: 0.84rem; }
    .data-table tbody tr:last-child td { border-bottom: none; }
    .data-table tbody tr:hover { background: #f8fafc; }
    .cell-op { font-weight: 600; color: #334155; }
    .cell-num {
      text-align: right; font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem; font-variant-numeric: tabular-nums; color: #94a3b8;
    }
    .cell-num.is-best {
      color: #059669; font-weight: 700; background: #ecfdf5;
    }
    .cell-num.is-slow { color: #dc2626; }
    .cell-num.is-na { color: #cbd5e1; }
    .cell-winner { text-align: center; }

    /* Winner badges */
    .winner-badge {
      display: inline-block; padding: 2px 10px; border-radius: 20px;
      font-size: 0.7rem; font-weight: 700; letter-spacing: 0.01em;
    }
    .winner-badge.purity { background: #ede9fe; color: #7c3aed; }
    .winner-badge.solid  { background: #dbeafe; color: #2563eb; }
    .winner-badge.svelte { background: #fee2e2; color: #dc2626; }
    .winner-badge.vue    { background: #dcfce7; color: #16a34a; }

    /* ── Memory ──────────────────────────────── */
    .mem-metrics { display: flex; gap: 2rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .mem-metric { flex: 1; min-width: 200px; }
    .mem-metric-label {
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 4px;
    }
    .mem-note {
      color: #94a3b8; font-size: 0.78rem; margin-bottom: 1rem; line-height: 1.5;
    }
    .mem-note code {
      background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 0.75rem;
    }

    /* ── History ──────────────────────────────── */
    .history-item { margin-bottom: 6px; }
    .history-item summary {
      cursor: pointer; padding: 12px 16px; background: #fff;
      border-radius: 10px; font-size: 0.84rem; font-weight: 500;
      color: #0f172a; display: flex; align-items: center; gap: 12px;
      list-style: none; transition: background .15s;
      box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.04);
    }
    .history-item summary:hover { background: #f8fafc; }
    .history-item summary::before {
      content: '\\25B8'; font-size: 0.65rem; color: #94a3b8;
      transition: transform .15s; flex-shrink: 0;
    }
    .history-item[open] summary::before { transform: rotate(90deg); }
    .history-date { font-weight: 700; }
    .history-wins {
      font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
      color: #94a3b8; font-weight: 500;
    }
    .history-body { padding: 1rem 0; }
    .history-body .scoreboard { margin: 1rem 0; }
    .history-body .data-table { font-size: 0.82rem; }

    /* ── Footer ──────────────────────────────── */
    .site-footer {
      margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #e2e8f0;
      text-align: center;
    }
    .site-footer a { color: #7c3aed; text-decoration: none; font-weight: 600; }
    .site-footer a:hover { text-decoration: underline; }
    .footer-actions { font-size: 0.85rem; color: #64748b; }
    .footer-method {
      margin-top: 0.75rem; font-size: 0.72rem; color: #94a3b8; line-height: 1.6;
    }
    .footer-brand {
      margin-top: 0.5rem; font-size: 0.72rem; color: #cbd5e1;
    }

    .empty-msg { color: #94a3b8; font-size: 0.88rem; }

    /* ── Responsive ──────────────────────────── */
    @media (max-width: 768px) {
      .hero { padding: 2.5rem 0 1.5rem; }
      .hero-title { font-size: 2rem; }
      .scoreboard { grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .score-num { font-size: 1.6rem; }
      .data-table { min-width: 560px; }
      .data-table th { padding: 8px 10px; font-size: 0.65rem; }
      .data-table td { padding: 6px 10px; font-size: 0.8rem; }
      .mem-metrics { gap: 1rem; }
      .chart-ms { width: 48px; font-size: 0.62rem; }
    }

    @media (max-width: 480px) {
      .page { padding: 0 0.75rem 2rem; }
      .sticky-nav { margin: 0 -0.75rem; padding-left: 0.75rem; padding-right: 0.75rem; }
      .hero-title { font-size: 1.6rem; }
      .hero-sub { font-size: 0.85rem; }
      .scoreboard { grid-template-columns: 1fr 1fr; gap: 6px; margin: 1.5rem 0 1rem; }
      .score-card { border-radius: 8px; }
      .score-body { padding: 0.75rem 1rem; }
      .score-num { font-size: 1.3rem; }
      .score-meta { font-size: 0.68rem; }
      .category { margin-top: 2rem; }
      .cat-title { font-size: 1.1rem; }
      .chart-fw { width: 16px; font-size: 0.6rem; }
      .chart-bar { height: 18px; }
      .chart-track { height: 12px; }
      .chart-ms { width: 42px; font-size: 0.58rem; }
      .nav-pill { padding: 5px 10px; font-size: 0.72rem; }
      .data-table { min-width: 500px; }
      .mem-metrics { flex-direction: column; gap: 0.5rem; }
      .history-item summary { padding: 8px 12px; font-size: 0.78rem; }
      .site-footer { margin-top: 2rem; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  applyGlobalStyles();

  const groups = groupByCategory(data.speed);
  const totalWins = countWins(data.speed);

  // Scroll-spy drives the active nav pill
  const activeNav = state<string | null>(null);

  const categories = groups.map((g) => g.category.toLowerCase());
  if (data.memory.length) categories.push("memory");

  onMount(() => {
    setupScrollSpy((val) => activeNav(val));
  });

  function navPillClass(id: string | null) {
    return compute(() => `nav-pill${activeNav() === id ? " active" : ""}`);
  }

  return html`
    <div class="page">
      <header class="hero">
        <h1 class="hero-title"><span class="accent">Purity</span> Benchmarks</h1>
        <p class="hero-sub">vs Solid, Svelte & Vue ${CHARS.dash} automated in headless Chromium</p>
        ${Scoreboard(totalWins)}
      </header>
    </div>

    <nav class="sticky-nav">
      <div class="nav-pills">
        <button :class=${navPillClass(null)} @click=${() => scrollTo(`cat-${categories[0]}`)}>
          All
        </button>
        ${groups.map(
          (g) =>
            html`<button
              :class=${navPillClass(g.category.toLowerCase())}
              @click=${() => scrollTo(`cat-${g.category.toLowerCase()}`)}
            >
              ${g.category}
            </button>`,
        )}
        ${data.memory.length
          ? html`<button :class=${navPillClass("memory")} @click=${() => scrollTo("cat-memory")}>
              Memory
            </button>`
          : ""}
      </div>
    </nav>

    <div class="page">
      ${groups.map((g) => CategorySection(g))} ${MemorySection()} ${PreviousRunsSection()}

      <footer class="site-footer">
        <div class="footer-actions">
          Run a new benchmark:
          <a href="https://github.com/KoalaFacts/Purity/actions"
            >Actions ${CHARS.arrow} Benchmark</a
          >
        </div>
        <div class="footer-method">
          Warmup 3 ${CHARS.dot} Measured 7 ${CHARS.dot} Drop fastest 1 + slowest 1 ${CHARS.dot}
          Metric: trimmed median ${CHARS.dot} Framework order randomized
        </div>
        <div class="footer-brand">
          Built with <a href="https://github.com/KoalaFacts/Purity">Purity</a> ${CHARS.dash} 17
          functions, 6 kB gzipped
        </div>
      </footer>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(App, document.getElementById("app")!);
