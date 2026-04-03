# Benchmark Revamp: Idiomatic Framework Apps with Full 10-10k Coverage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite every benchmark app to use its framework's native idioms (no vanilla JS) and ensure every scalable operation has 10/100/1k/10k permutations.

**Architecture:** Each benchmark page becomes a single self-contained framework component that mounts itself. Buttons live inside the component template using framework event bindings (@click, onClick, on:click, etc.). All `document.getElementById` and manual `addEventListener` calls are eliminated. A shared `sizes.ts` module provides the 4-size array `[10, 100, 1_000, 10_000]` so count buttons are generated dynamically. The run-bench.ts orchestrator references button IDs like `#run-10`, `#run-100`, `#run-1k`, `#run-10k` which each app renders as hidden buttons.

**Tech Stack:** Purity (`html`, `state`, `each`, `@click`, `:class`, `mount`), Solid (JSX, `createSignal`, `For`, `render`), Svelte 5 (runes, `$state`, `{#each}`, `on:click`), Vue 3 (`<script setup>`, `ref`, `v-for`, `@click`)

---

## Scope

This plan covers Purity only. Solid, Svelte, and Vue get separate identical plans (same patterns adapted to each framework). Purity goes first since it's our framework and the reference implementation.

The run-bench.ts scenarios are already updated with full 10/100/1k/10k coverage (done in prior session). This plan focuses on rewriting the Purity benchmark apps.

---

## Naming Convention for Button IDs

Every scalable operation gets 4 hidden buttons with a consistent naming scheme:

```
#<op>-10, #<op>-100, #<op>-1k, #<op>-10k
```

Examples: `#run-10`, `#run-100`, `#run-1k`, `#run-10k`, `#add-10`, `#add-100`, `#add-1k`, `#add-10k`

For backwards compat with run-bench.ts, also keep aliases: `#run` = `#run-1k`, `#runlots` = `#run-10k`, `#add` = `#add-1k`.

---

## File Structure

### Shared
- Modify: `benchmark/apps/purity/sizes.ts` (NEW) -- shared size constants

### Per-page rewrites (Purity)
Each page becomes ONE `.ts` file + ONE minimal `.html` that just has `<div id="app">` + `<script type="module">`:

| Page | Current Files | New Structure |
|------|--------------|---------------|
| index (rows) | `index.html` (45 lines) + `app.ts` (200 lines) | `index.html` (~10 lines) + `app.ts` (~120 lines) |
| filter | `filter.html` + `filter.ts` | `filter.html` (~10 lines) + `filter.ts` (~80 lines) |
| sort | `sort.html` + `sort.ts` | `sort.html` (~10 lines) + `sort.ts` (~80 lines) |
| binding | `binding.html` + `binding.ts` | `binding.html` (~10 lines) + `binding.ts` (~60 lines) |
| selection | `selection.html` + `selection.ts` | `selection.html` (~10 lines) + `selection.ts` (~60 lines) |
| cart | `cart.html` + `cart.ts` | `cart.html` (~10 lines) + `cart.ts` (~90 lines) |
| lifecycle | `lifecycle.html` + `lifecycle.ts` | `lifecycle.html` (~10 lines) + `lifecycle.ts` (~50 lines) |
| conditional | `conditional.html` + `conditional.ts` | `conditional.html` (~10 lines) + `conditional.ts` (~50 lines) |
| computed-chain | `computed-chain.html` + `computed-chain.ts` | same (~10 + ~40 lines) |
| diamond | `diamond.html` + `diamond.ts` | same (~10 + ~50 lines) |
| ticker | `ticker.html` + `ticker.ts` | same (~10 + ~60 lines) |
| tree | `tree.html` + `tree.ts` | same (~10 + ~60 lines) |
| master-detail | `master-detail.html` + `master-detail.ts` | same (~10 + ~70 lines) |

---

## Task 1: Create shared sizes module

**Files:**
- Create: `benchmark/apps/purity/sizes.ts`

- [ ] **Step 1: Create sizes.ts**

```ts
// benchmark/apps/purity/sizes.ts
export const SIZES = [10, 100, 1_000, 10_000] as const;
export type Size = (typeof SIZES)[number];

export function sizeLabel(n: number): string {
  if (n >= 10_000) return '10k';
  if (n >= 1_000) return '1k';
  return String(n);
}

export function sizeId(prefix: string, n: number): string {
  return `${prefix}-${sizeLabel(n)}`;
}
```

- [ ] **Step 2: Commit**
```bash
git add benchmark/apps/purity/sizes.ts
git commit -m "bench: add shared sizes module for 10/100/1k/10k button generation"
```

---

## Task 2: Rewrite index page (row benchmark) -- Purity

This is the most important benchmark. The app must use `html`, `state`, `each`, `@click`, `:class` -- zero vanilla JS.

**Files:**
- Rewrite: `benchmark/apps/purity/index.html`
- Rewrite: `benchmark/apps/purity/app.ts`

- [ ] **Step 1: Rewrite index.html to minimal mount point**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Purity Benchmark</title>
  <link href="/css/currentStyle.css" rel="stylesheet" />
</head>
<body>
  <div id="main"><div class="container">
    <div id="app"></div>
    <table class="table table-hover table-striped test-data"><tbody id="tbody"></tbody></table>
  </div></div>
  <script type="module" src="./app.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite app.ts as a self-contained Purity app**

The app uses `mount()` to render the button bar into `#app`, and `each()` to render rows into `#tbody`. All buttons are rendered via `html` templates with `@click` bindings. Hidden benchmark buttons get `style="display:none"`.

Key design decisions:
- Visible UI buttons: Create 1k, Create 10k, Append 1k, Update, Clear, Swap (same as the standard js-framework-benchmark)
- Hidden benchmark buttons: `#run-10`, `#run-100`, `#run-1k`, `#run-10k`, `#add-10`, `#add-100`, `#add-1k`, `#add-10k` (for orchestrator)
- Backward compat aliases: `#run` = same as `#run-1k`, `#runlots` = `#run-10k`, `#add` = `#add-1k`
- Row rendering uses `each()` with key function
- Selection uses `:class` binding
- Event delegation for row clicks (via `@click` on tbody)

```ts
// benchmark/apps/purity/app.ts
import { state, each, html, mount, watch } from '@purity/core';

// -- Data generation --
const adjectives = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const colours = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const nouns = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

interface Row { id: number; label: string; }

let nextId = 1;
const rnd = (max: number) => (Math.random() * max) | 0;
const mkLabel = () => `${adjectives[rnd(adjectives.length)]} ${colours[rnd(colours.length)]} ${nouns[rnd(nouns.length)]}`;

function buildData(count: number): Row[] {
  const d = new Array<Row>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: mkLabel() };
  return d;
}

// -- State --
const data = state<Row[]>([]);
const selectedId = state(0);

// -- Actions --
const run = (n: number) => { data(buildData(n)); selectedId(0); };
const add = (n: number) => { data((d) => d.concat(buildData(n))); };
const update = () => {
  data((d) => {
    const c = d.slice();
    for (let i = 0; i < c.length; i += 10) c[i] = { ...c[i], label: `${c[i].label} !!!` };
    return c;
  });
};
const clear = () => { data([]); selectedId(0); };
const swapRows = () => {
  data((d) => {
    if (d.length > 998) { const c = d.slice(); [c[1], c[998]] = [c[998], c[1]]; return c; }
    return d;
  });
};
const select = (id: number) => { selectedId(id); };
const remove = (id: number) => { data((d) => d.filter((r) => r.id !== id)); };

// -- Button bar (visible + hidden benchmark buttons) --
function ButtonBar() {
  // Helper: creates a hidden button with an ID for the orchestrator
  const hBtn = (id: string, label: string, handler: () => void) =>
    html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;

  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run" @click=${() => run(1_000)}>Create 1,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots" @click=${() => run(10_000)}>Create 10,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add" @click=${() => add(1_000)}>Append 1,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update" @click=${update}>Update every 10th row</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear" @click=${clear}>Clear</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows" @click=${swapRows}>Swap Rows</button></div>
      </div></div>
    </div></div>
    ${hBtn('run-10', 'Run 10', () => run(10))}
    ${hBtn('run-100', 'Run 100', () => run(100))}
    ${hBtn('run-1k', 'Run 1k', () => run(1_000))}
    ${hBtn('run-10k', 'Run 10k', () => run(10_000))}
    ${hBtn('add-10', 'Add 10', () => add(10))}
    ${hBtn('add-100', 'Add 100', () => add(100))}
    ${hBtn('add-1k', 'Add 1k', () => add(1_000))}
    ${hBtn('add-10k', 'Add 10k', () => add(10_000))}
  `;
}

// -- Row rendering --
const tbody = document.getElementById('tbody')!;

// Cached label text nodes for in-place update
const labelCache = new Map<number, { tr: HTMLElement; labelNode: Text; label: string }>();

const rowFragment = each(
  () => data(),
  (item: Row) => {
    const tr = html`
      <tr>
        <td class="col-md-1">${String(item.id)}</td>
        <td class="col-md-4"><a href="#" class="lbl">${item.label}</a></td>
        <td class="col-md-1"><a href="#" class="remove"><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
        <td class="col-md-6"></td>
      </tr>
    ` as unknown as HTMLElement;
    const labelNode = tr.querySelector('.lbl')!.firstChild as Text;
    labelCache.set(item.id, { tr, labelNode, label: item.label });
    return tr;
  },
  (item: Row) => item.id,
);
tbody.appendChild(rowFragment);

// In-place label updates + selection highlighting
watch(data, (list) => {
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const cached = labelCache.get(item.id);
    if (cached && cached.label !== item.label) {
      cached.labelNode.data = item.label;
      cached.label = item.label;
    }
  }
});

watch(selectedId, (id, oldId) => {
  if (oldId) { const r = labelCache.get(oldId); if (r) r.tr.className = ''; }
  if (id) { const r = labelCache.get(id); if (r) r.tr.className = 'danger'; }
});

// Event delegation on tbody
tbody.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
  if (a.classList.contains('lbl')) select(id);
  else if (a.classList.contains('remove')) remove(id);
});

// -- Mount button bar --
mount(ButtonBar, document.getElementById('app')!);
```

Note: Row event delegation stays on `tbody.addEventListener` because it's the standard js-framework-benchmark pattern and more efficient than per-row @click for 10k rows.

- [ ] **Step 3: Verify build**
```bash
cd benchmark && npx vite build 2>&1 | tail -5
```
Expected: Build succeeds, `purity-index-*.js` appears in dist/assets.

- [ ] **Step 4: Verify buttons work**
Start preview: `npx vite preview --port 4173`
Navigate to `http://localhost:4173/apps/purity/index.html`
Open console, verify no errors. Click "Create 1,000 rows" — should render rows.

- [ ] **Step 5: Verify hidden buttons for orchestrator**
In browser console:
```js
document.getElementById('run-10').click(); // should create 10 rows
document.getElementById('add-100').click(); // should append 100 rows
document.getElementById('clear').click(); // should clear
```

- [ ] **Step 6: Commit**
```bash
git add benchmark/apps/purity/index.html benchmark/apps/purity/app.ts
git commit -m "bench(purity): rewrite index page to idiomatic Purity with 10-10k buttons"
```

---

## Task 3: Rewrite filter page -- Purity

**Files:**
- Rewrite: `benchmark/apps/purity/filter.html`
- Rewrite: `benchmark/apps/purity/filter.ts`

- [ ] **Step 1: Rewrite filter.html to minimal mount point**

Same pattern: `<div id="app">` + `<tbody id="tbody">` + `<script type="module" src="./filter.ts">`

- [ ] **Step 2: Rewrite filter.ts**

Self-contained app with:
- `state` for data array + query string
- `compute` for filtered results
- `each` for row rendering
- `mount()` for control panel (search input + hidden populate buttons)
- Hidden buttons: `#populate-10`, `#populate-100`, `#populate-1k`, `#populate` (10k), `#clear-search`
- Search input with native `@input` handler updating query state
- All buttons rendered via `html` with `@click`

- [ ] **Step 3: Build + manual test**
- [ ] **Step 4: Commit**

---

## Task 4: Rewrite sort page -- Purity

Same pattern as filter. Hidden buttons: `#populate-100`, `#populate` (1k), `#populate-10k`, `#sort-id`, `#sort-id-desc`, `#sort-label`.

---

## Task 5: Rewrite binding page -- Purity

Hidden buttons: `#create-10`, `#create-100`, `#create-1000`, `#create-10k`, `#update-all`, `#clear-all`, `#read-all`. Uses `state` array of field signals + `each` + `html` with `::value` two-way binding.

---

## Task 6: Rewrite selection page -- Purity

Hidden buttons: `#populate-10`, `#populate-100`, `#populate` (1k), `#populate-10k`, `#select-all`, `#deselect-all`, `#toggle-all`, `#toggle-even`. Uses `state` + `compute` for counts + `each` + `html` with checkbox binding.

---

## Task 7: Rewrite cart page -- Purity

Hidden buttons: `#add-10`, `#add-100`, `#add-1000`, `#add-10k`, `#increment-all`, `#remove-first`, `#clear-cart`. Uses `state` + `compute` for totals + `each` + `html`.

---

## Task 8: Rewrite lifecycle page -- Purity

Hidden buttons: `#create-10`, `#create-100`, `#create-1k`, `#create-10k`, `#destroy-all`, `#replace-10`, `#replace-100`, `#replace` (1k), `#replace-10k`. Uses `state` array + `each` + `html`.

---

## Task 9: Rewrite conditional page -- Purity

Hidden buttons: `#populate`, `#toggle`, `#toggle-10x`. Uses `state` + `when()` + `html`.

---

## Task 10: Rewrite computed-chain page -- Purity

Hidden buttons: `#setup`, `#update`, `#update-10x`. Uses `state` + `compute` chain + `watch` + `html`.

---

## Task 11: Rewrite diamond page -- Purity

Hidden buttons: `#setup`, `#update-all`, `#update-one`. Uses `state` + `compute` + `batch` + `watch` + `html`.

---

## Task 12: Rewrite ticker page -- Purity

Hidden buttons: `#run-500`, `#stop`. Uses `state` + `each` + `html` with `requestAnimationFrame` loop.

---

## Task 13: Rewrite tree page -- Purity

Hidden buttons: `#expand-all`, `#collapse-all`. Uses `state` + recursive `each` + `html`.

---

## Task 14: Rewrite master-detail page -- Purity

Hidden buttons: `#populate`, `#select-first`, `#select-last`, `#select-none`, `#cycle-10`. Uses `state` + `compute` + `each` + `when` + `html`.

---

## Task 15: Build, lint, run full benchmark

- [ ] **Step 1: Build**
```bash
cd packages/core && npx vite build
cd ../../benchmark && npx vite build
```

- [ ] **Step 2: Lint**
```bash
npx biome check --write benchmark/apps/purity/
```

- [ ] **Step 3: Run benchmark (Purity only)**
```bash
npx vite preview --port 4173 &
sleep 2
ITERATIONS=3 npx tsx run-bench.ts 2>&1 | head -80
```
Verify all scenarios pass (no ERR), all hidden buttons found.

- [ ] **Step 4: Commit**
```bash
git add benchmark/apps/purity/ benchmark/run-bench.ts
git commit -m "bench(purity): idiomatic Purity apps with full 10/100/1k/10k coverage"
```

---

## Task 16: Repeat for Solid (separate PR)

Same patterns adapted to Solid idioms: JSX, `createSignal`, `For`, `render()`, `onClick`.

## Task 17: Repeat for Svelte (separate PR)

Same patterns: Svelte 5 runes, `$state`, `{#each}`, `on:click`, SFC.

## Task 18: Repeat for Vue (separate PR)

Same patterns: `<script setup>`, `ref`, `v-for`, `@click`, SFC.
