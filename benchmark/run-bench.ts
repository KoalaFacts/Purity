#!/usr/bin/env node
// Playwright orchestrator — runs each framework's scenario pages in headless
// Chromium, performs operations via button clicks, and measures framework
// work after microtask flush plus forced layout.
//
// Usage: cd benchmark && npm run build-prod && npx vite preview & node --import tsx run-bench.ts

import { chromium, type Page } from 'playwright';

const PORT = process.env.PORT || 4173;
const BASE = `http://localhost:${PORT}/Purity`;
const WARMUP = parseInt(process.env.WARMUP || '3', 10);
const ITERATIONS = parseInt(process.env.ITERATIONS || '7', 10);
const MEM_ITERATIONS = parseInt(process.env.MEM_ITERATIONS || '3', 10);
const DROP_OUTLIERS = 1; // drop N fastest + N slowest before computing median
const ALL_FRAMEWORKS = ['purity', 'solid', 'svelte', 'vue'] as const;
type Framework = (typeof ALL_FRAMEWORKS)[number];
const FRAMEWORKS = selectFrameworks();

function selectFrameworks(): Framework[] {
  const requested = new Set(
    (process.env.FRAMEWORKS || '')
      .split(',')
      .map((fw) => fw.trim())
      .filter(Boolean),
  );
  if (requested.size === 0) return [...ALL_FRAMEWORKS];
  const selected = ALL_FRAMEWORKS.filter((fw) => requested.has(fw));
  if (selected.length === 0) {
    throw new Error(`No valid frameworks selected from FRAMEWORKS=${process.env.FRAMEWORKS}`);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

interface Step {
  /** Button id to click (or 'input#id' for typing) */
  action: string;
  /** Value to type (for input actions) */
  value?: string;
  /** Delay after action in ms */
  delay?: number;
}

interface Scenario {
  /** Scenario page name (without .html) */
  page: string;
  /** Human-readable category */
  category: string;
  /** Operations to benchmark within this scenario */
  ops: {
    name: string;
    /** Steps to run as setup (not measured) */
    setup?: Step[];
    /** Steps to measure */
    steps: Step[];
  }[];
}

const SCENARIOS: Scenario[] = [
  // === Rendering (index page) — every op: 10, 100, 1k, 10k ===
  {
    page: 'index',
    category: 'Rendering',
    ops: [
      // Create
      { name: 'Create 10 rows', setup: [{ action: '#clear' }], steps: [{ action: '#run-10' }] },
      { name: 'Create 100 rows', setup: [{ action: '#clear' }], steps: [{ action: '#run-100' }] },
      { name: 'Create 1,000 rows', setup: [{ action: '#clear' }], steps: [{ action: '#run' }] },
      {
        name: 'Create 10,000 rows',
        setup: [{ action: '#clear' }],
        steps: [{ action: '#runlots' }],
      },
      // Append
      {
        name: 'Append 10 rows',
        setup: [{ action: '#clear' }, { action: '#run-10' }],
        steps: [{ action: '#add-10' }],
      },
      {
        name: 'Append 100 rows',
        setup: [{ action: '#clear' }, { action: '#run-100' }],
        steps: [{ action: '#add-100' }],
      },
      {
        name: 'Append 1,000 rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#add' }],
      },
      {
        name: 'Append 10,000 rows',
        setup: [{ action: '#clear' }, { action: '#runlots' }],
        steps: [{ action: '#add-10k' }],
      },
      // Replace
      {
        name: 'Replace 10 rows',
        setup: [{ action: '#clear' }, { action: '#run-10' }],
        steps: [{ action: '#run-10' }],
      },
      {
        name: 'Replace 100 rows',
        setup: [{ action: '#clear' }, { action: '#run-100' }],
        steps: [{ action: '#run-100' }],
      },
      {
        name: 'Replace 1,000 rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#run' }],
      },
      {
        name: 'Replace 10,000 rows',
        setup: [{ action: '#clear' }, { action: '#runlots' }],
        steps: [{ action: '#runlots' }],
      },
      // Update every 10th
      {
        name: 'Update every 10th (10)',
        setup: [{ action: '#clear' }, { action: '#run-10' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Update every 10th (100)',
        setup: [{ action: '#clear' }, { action: '#run-100' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Update every 10th (1k)',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Update every 10th (10k)',
        setup: [{ action: '#clear' }, { action: '#runlots' }],
        steps: [{ action: '#update' }],
      },
      // Swap
      {
        name: 'Swap rows (1k)',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#swaprows' }],
      },
      {
        name: 'Swap rows (10k)',
        setup: [{ action: '#clear' }, { action: '#runlots' }],
        steps: [{ action: '#swaprows' }],
      },
      // Clear
      {
        name: 'Clear 10 rows',
        setup: [{ action: '#clear' }, { action: '#run-10' }],
        steps: [{ action: '#clear' }],
      },
      {
        name: 'Clear 100 rows',
        setup: [{ action: '#clear' }, { action: '#run-100' }],
        steps: [{ action: '#clear' }],
      },
      {
        name: 'Clear 1,000 rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#clear' }],
      },
      {
        name: 'Clear 10,000 rows',
        setup: [{ action: '#clear' }, { action: '#runlots' }],
        steps: [{ action: '#clear' }],
      },
    ],
  },
  // === Computed ===
  {
    page: 'filter',
    category: 'Computed',
    ops: [
      // Filter: 10, 100, 1k, 10k
      {
        name: 'Filter 10 (type "e")',
        setup: [{ action: '#populate-10' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'e' }],
      },
      {
        name: 'Filter 100 (type "e")',
        setup: [{ action: '#populate-100' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'e' }],
      },
      {
        name: 'Filter 1k (type "e")',
        setup: [{ action: '#populate-1k' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'e' }],
      },
      {
        name: 'Filter 10k (type "e")',
        setup: [{ action: '#populate' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'e' }],
      },
      // Clear filter: 10, 100, 1k, 10k
      {
        name: 'Clear filter (10)',
        setup: [{ action: '#populate-10' }, { action: 'input#search', value: 'fancy' }],
        steps: [{ action: '#clear-search' }],
      },
      {
        name: 'Clear filter (100)',
        setup: [{ action: '#populate-100' }, { action: 'input#search', value: 'fancy' }],
        steps: [{ action: '#clear-search' }],
      },
      {
        name: 'Clear filter (1k)',
        setup: [{ action: '#populate-1k' }, { action: 'input#search', value: 'fancy' }],
        steps: [{ action: '#clear-search' }],
      },
      {
        name: 'Clear filter (10k)',
        setup: [{ action: '#populate' }, { action: 'input#search', value: 'fancy' }],
        steps: [{ action: '#clear-search' }],
      },
    ],
  },
  {
    page: 'sort',
    category: 'Computed',
    ops: [
      // Sort by ID ↑: 100, 1k, 10k (10 is trivial for sort)
      {
        name: 'Sort 100 by ID ↑',
        setup: [{ action: '#populate-100' }],
        steps: [{ action: '#sort-id' }],
      },
      {
        name: 'Sort 1k by ID ↑',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-id' }],
      },
      {
        name: 'Sort 10k by ID ↑',
        setup: [{ action: '#populate-10k' }],
        steps: [{ action: '#sort-id' }],
      },
      // Sort by ID ↓
      {
        name: 'Sort 100 by ID ↓',
        setup: [{ action: '#populate-100' }],
        steps: [{ action: '#sort-id-desc' }],
      },
      {
        name: 'Sort 1k by ID ↓',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-id-desc' }],
      },
      {
        name: 'Sort 10k by ID ↓',
        setup: [{ action: '#populate-10k' }],
        steps: [{ action: '#sort-id-desc' }],
      },
      // Sort by label
      {
        name: 'Sort 100 by label',
        setup: [{ action: '#populate-100' }],
        steps: [{ action: '#sort-label' }],
      },
      {
        name: 'Sort 1k by label',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-label' }],
      },
      {
        name: 'Sort 10k by label',
        setup: [{ action: '#populate-10k' }],
        steps: [{ action: '#sort-label' }],
      },
    ],
  },
  {
    page: 'computed-chain',
    category: 'Computed',
    ops: [
      {
        name: 'Computed chain (10 levels)',
        setup: [{ action: '#setup-10' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Computed chain (100 levels)',
        setup: [{ action: '#setup-100' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Computed chain (1,000 levels)',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Computed chain (10,000 levels)',
        setup: [{ action: '#setup-10k' }],
        steps: [{ action: '#update' }],
      },
    ],
  },
  {
    page: 'diamond',
    category: 'Computed',
    ops: [
      {
        name: 'Diamond (10) update all',
        setup: [{ action: '#setup-10' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Diamond (100) update all',
        setup: [{ action: '#setup-100' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Diamond (1,000) update all',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Diamond (10,000) update all',
        setup: [{ action: '#setup-10k' }],
        steps: [{ action: '#update-all' }],
      },
    ],
  },
  // === Components ===
  {
    page: 'cart',
    category: 'Components',
    ops: [
      // Add: 10, 100, 1k, 10k
      {
        name: 'Add 10 cart items',
        setup: [{ action: '#clear-cart' }],
        steps: [{ action: '#add-10' }],
      },
      {
        name: 'Add 100 cart items',
        setup: [{ action: '#clear-cart' }],
        steps: [{ action: '#add-100' }],
      },
      {
        name: 'Add 1,000 cart items',
        setup: [{ action: '#clear-cart' }],
        steps: [{ action: '#add-1000' }],
      },
      {
        name: 'Add 10,000 cart items',
        setup: [{ action: '#clear-cart' }],
        steps: [{ action: '#add-10k' }],
      },
      // Increment all: 10, 100, 1k, 10k
      {
        name: 'Increment all (10)',
        setup: [{ action: '#clear-cart' }, { action: '#add-10' }],
        steps: [{ action: '#increment-all' }],
      },
      {
        name: 'Increment all (100)',
        setup: [{ action: '#clear-cart' }, { action: '#add-100' }],
        steps: [{ action: '#increment-all' }],
      },
      {
        name: 'Increment all (1k)',
        setup: [{ action: '#clear-cart' }, { action: '#add-1000' }],
        steps: [{ action: '#increment-all' }],
      },
      {
        name: 'Increment all (10k)',
        setup: [{ action: '#clear-cart' }, { action: '#add-10k' }],
        steps: [{ action: '#increment-all' }],
      },
      // Clear: 10, 100, 1k, 10k
      {
        name: 'Clear cart (10)',
        setup: [{ action: '#clear-cart' }, { action: '#add-10' }],
        steps: [{ action: '#clear-cart' }],
      },
      {
        name: 'Clear cart (100)',
        setup: [{ action: '#clear-cart' }, { action: '#add-100' }],
        steps: [{ action: '#clear-cart' }],
      },
      {
        name: 'Clear cart (1k)',
        setup: [{ action: '#clear-cart' }, { action: '#add-1000' }],
        steps: [{ action: '#clear-cart' }],
      },
      {
        name: 'Clear cart (10k)',
        setup: [{ action: '#clear-cart' }, { action: '#add-10k' }],
        steps: [{ action: '#clear-cart' }],
      },
    ],
  },
  {
    page: 'conditional',
    category: 'Components',
    ops: [
      {
        name: 'Toggle 10 section (show)',
        setup: [{ action: '#populate-10' }],
        steps: [{ action: '#toggle' }],
      },
      {
        name: 'Toggle 100 section (show)',
        setup: [{ action: '#populate-100' }],
        steps: [{ action: '#toggle' }],
      },
      {
        name: 'Toggle 1k section (show)',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#toggle' }],
      },
      {
        name: 'Toggle 10k section (show)',
        setup: [{ action: '#populate-10k' }],
        steps: [{ action: '#toggle' }],
      },
      {
        name: 'Toggle 1k section (hide)',
        setup: [{ action: '#populate' }, { action: '#toggle' }],
        steps: [{ action: '#toggle' }],
      },
      { name: 'Toggle 10x', setup: [{ action: '#populate' }], steps: [{ action: '#toggle-10x' }] },
    ],
  },
  {
    page: 'lifecycle',
    category: 'Components',
    ops: [
      // Create: 10, 100, 1k, 10k
      {
        name: 'Create 10 components',
        setup: [{ action: '#destroy-all' }],
        steps: [{ action: '#create-10' }],
      },
      {
        name: 'Create 100 components',
        setup: [{ action: '#destroy-all' }],
        steps: [{ action: '#create-100' }],
      },
      {
        name: 'Create 1k components',
        setup: [{ action: '#destroy-all' }],
        steps: [{ action: '#create-1k' }],
      },
      {
        name: 'Create 10k components',
        setup: [{ action: '#destroy-all' }],
        steps: [{ action: '#create-10k' }],
      },
      // Destroy: 10, 100, 1k, 10k
      {
        name: 'Destroy 10 components',
        setup: [{ action: '#destroy-all' }, { action: '#create-10' }],
        steps: [{ action: '#destroy-all' }],
      },
      {
        name: 'Destroy 100 components',
        setup: [{ action: '#destroy-all' }, { action: '#create-100' }],
        steps: [{ action: '#destroy-all' }],
      },
      {
        name: 'Destroy 1k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-1k' }],
        steps: [{ action: '#destroy-all' }],
      },
      {
        name: 'Destroy 10k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-10k' }],
        steps: [{ action: '#destroy-all' }],
      },
      // Replace: 10, 100, 1k, 10k
      {
        name: 'Replace 10 components',
        setup: [{ action: '#destroy-all' }, { action: '#create-10' }],
        steps: [{ action: '#replace-10' }],
      },
      {
        name: 'Replace 100 components',
        setup: [{ action: '#destroy-all' }, { action: '#create-100' }],
        steps: [{ action: '#replace-100' }],
      },
      {
        name: 'Replace 1k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-1k' }],
        steps: [{ action: '#replace' }],
      },
      {
        name: 'Replace 10k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-10k' }],
        steps: [{ action: '#replace-10k' }],
      },
    ],
  },
  {
    page: 'tree',
    category: 'Components',
    ops: [
      {
        name: 'Expand all tree nodes',
        setup: [{ action: '#collapse-all' }],
        steps: [{ action: '#expand-all' }],
      },
      {
        name: 'Collapse all tree nodes',
        setup: [{ action: '#expand-all' }],
        steps: [{ action: '#collapse-all' }],
      },
    ],
  },
  {
    page: 'master-detail',
    category: 'Components',
    ops: [
      {
        name: 'Select detail (first)',
        setup: [{ action: '#populate' }, { action: '#select-none' }],
        steps: [{ action: '#select-first' }],
      },
      {
        name: 'Select detail (last)',
        setup: [{ action: '#populate' }, { action: '#select-none' }],
        steps: [{ action: '#select-last' }],
      },
      {
        name: 'Cycle 10 selections',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#cycle-10' }],
      },
    ],
  },
  // === Interaction ===
  {
    page: 'binding',
    category: 'Interaction',
    ops: [
      // Create: 10, 100, 1k, 10k
      { name: 'Create 10 bound inputs', setup: [], steps: [{ action: '#create-10' }] },
      { name: 'Create 100 bound inputs', setup: [], steps: [{ action: '#create-100' }] },
      { name: 'Create 1,000 bound inputs', setup: [], steps: [{ action: '#create-1000' }] },
      { name: 'Create 10,000 bound inputs', setup: [], steps: [{ action: '#create-10k' }] },
      // Update: 10, 100, 1k, 10k
      {
        name: 'Update all (10)',
        setup: [{ action: '#create-10' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Update all (100)',
        setup: [{ action: '#create-100' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Update all (1k)',
        setup: [{ action: '#create-1000' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Update all (10k)',
        setup: [{ action: '#create-10k' }],
        steps: [{ action: '#update-all' }],
      },
      // Clear: 10, 100, 1k, 10k
      {
        name: 'Clear all (10)',
        setup: [{ action: '#create-10' }],
        steps: [{ action: '#clear-all' }],
      },
      {
        name: 'Clear all (100)',
        setup: [{ action: '#create-100' }],
        steps: [{ action: '#clear-all' }],
      },
      {
        name: 'Clear all (1k)',
        setup: [{ action: '#create-1000' }],
        steps: [{ action: '#clear-all' }],
      },
      {
        name: 'Clear all (10k)',
        setup: [{ action: '#create-10k' }],
        steps: [{ action: '#clear-all' }],
      },
    ],
  },
  {
    page: 'selection',
    category: 'Interaction',
    ops: [
      // Select all: 10, 100, 1k, 10k
      {
        name: 'Select all (10)',
        setup: [{ action: '#populate-10' }, { action: '#deselect-all' }],
        steps: [{ action: '#select-all' }],
      },
      {
        name: 'Select all (100)',
        setup: [{ action: '#populate-100' }, { action: '#deselect-all' }],
        steps: [{ action: '#select-all' }],
      },
      {
        name: 'Select all (1k)',
        setup: [{ action: '#populate' }, { action: '#deselect-all' }],
        steps: [{ action: '#select-all' }],
      },
      {
        name: 'Select all (10k)',
        setup: [{ action: '#populate-10k' }, { action: '#deselect-all' }],
        steps: [{ action: '#select-all' }],
      },
      // Deselect all: 10, 100, 1k, 10k
      {
        name: 'Deselect all (10)',
        setup: [{ action: '#populate-10' }, { action: '#select-all' }],
        steps: [{ action: '#deselect-all' }],
      },
      {
        name: 'Deselect all (100)',
        setup: [{ action: '#populate-100' }, { action: '#select-all' }],
        steps: [{ action: '#deselect-all' }],
      },
      {
        name: 'Deselect all (1k)',
        setup: [{ action: '#populate' }, { action: '#select-all' }],
        steps: [{ action: '#deselect-all' }],
      },
      {
        name: 'Deselect all (10k)',
        setup: [{ action: '#populate-10k' }, { action: '#select-all' }],
        steps: [{ action: '#deselect-all' }],
      },
      // Toggle all: 10, 100, 1k, 10k
      {
        name: 'Toggle all (10)',
        setup: [{ action: '#populate-10' }],
        steps: [{ action: '#toggle-all' }],
      },
      {
        name: 'Toggle all (100)',
        setup: [{ action: '#populate-100' }],
        steps: [{ action: '#toggle-all' }],
      },
      {
        name: 'Toggle all (1k)',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#toggle-all' }],
      },
      {
        name: 'Toggle all (10k)',
        setup: [{ action: '#populate-10k' }],
        steps: [{ action: '#toggle-all' }],
      },
    ],
  },
  {
    page: 'ticker',
    category: 'Interaction',
    ops: [
      {
        name: 'Stock ticker (10 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-10' }],
      },
      {
        name: 'Stock ticker (100 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-100' }],
      },
      {
        name: 'Stock ticker (500 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-500' }],
      },
      {
        name: 'Stock ticker (1,000 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-1000' }],
      },
      {
        name: 'Stock ticker (10,000 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-10000' }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Memory scenario definitions
// ---------------------------------------------------------------------------

interface MemoryScenario {
  /** Scenario page name (without .html) */
  page: string;
  /** Human-readable category */
  category: string;
  /** Memory operations to benchmark */
  ops: {
    name: string;
    /** Steps to create/populate (measured: heap after) */
    create: Step[];
    /** Steps to tear down (measured: heap after — should return near baseline) */
    destroy: Step[];
  }[];
}

const MEMORY_SCENARIOS: MemoryScenario[] = [
  {
    page: 'index',
    category: 'Memory',
    ops: [
      {
        name: 'Create 1k rows',
        create: [{ action: '#run' }],
        destroy: [{ action: '#clear' }],
      },
      {
        name: 'Create 10k rows',
        create: [{ action: '#runlots' }],
        destroy: [{ action: '#clear' }],
      },
    ],
  },
  {
    page: 'lifecycle',
    category: 'Memory',
    ops: [
      {
        name: 'Create 1k components',
        create: [{ action: '#create-1k' }],
        destroy: [{ action: '#destroy-all' }],
      },
      {
        name: 'Create 10k components',
        create: [{ action: '#create-10k' }],
        destroy: [{ action: '#destroy-all' }],
      },
    ],
  },
  {
    page: 'filter',
    category: 'Memory',
    ops: [
      {
        name: 'Populate 10k filtered',
        create: [{ action: '#populate' }],
        destroy: [{ action: '#clear-search' }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function measureSteps(page: Page, steps: Step[]): Promise<number> {
  const duration = await page.evaluate(async (stepsData) => {
    const t0 = performance.now();
    for (const step of stepsData) {
      if (step.action.startsWith('input#')) {
        const input = document.querySelector(step.action) as HTMLInputElement;
        if (!input) throw new Error(`Missing input element: ${step.action}`);
        input.value = step.value || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const btn = document.querySelector(step.action) as HTMLElement;
        if (!btn) throw new Error(`Missing action element: ${step.action}`);
        btn.click();
      }
    }
    await Promise.resolve();
    document.body.getBoundingClientRect();
    return performance.now() - t0;
  }, steps);
  return duration;
}

async function runSetup(page: Page, steps: Step[]): Promise<void> {
  for (const step of steps) {
    if (step.action.startsWith('input#')) {
      await page.fill(step.action.replace('input', ''), step.value || '');
    } else {
      // Use page.evaluate for clicks — works with hidden buttons (display:none)
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) throw new Error(`Missing setup element: ${sel}`);
        el.click();
      }, step.action);
    }
    await settle(page);
    if (step.delay) await page.waitForTimeout(step.delay);
  }
}

async function getHeapKB(page: Page): Promise<number> {
  // Force GC if available, then measure heap
  const kb = await page.evaluate(() => {
    if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
    const mem = (performance as any).memory;
    return mem ? mem.usedJSHeapSize / 1024 : -1;
  });
  return kb;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

function trimmedMedian(arr: number[], drop: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  // Drop N fastest (front) and N slowest (back)
  const trimmed = drop > 0 && sorted.length > drop * 2 ? sorted.slice(drop, -drop) : sorted;
  const mid = Math.floor(trimmed.length / 2);
  return trimmed.length % 2 === 0 ? (trimmed[mid - 1] + trimmed[mid]) / 2 : trimmed[mid];
}

function selectScenarios<T extends { page: string }>(scenarios: T[], allowEmpty = false): T[] {
  const requested = new Set(
    (process.env.PAGES || '')
      .split(',')
      .map((page) => page.trim())
      .filter(Boolean),
  );
  if (requested.size === 0) return scenarios;
  const selected = scenarios.filter((scenario) => requested.has(scenario.page));
  if (selected.length === 0) {
    if (allowEmpty) return [];
    throw new Error(`No valid pages selected from PAGES=${process.env.PAGES}`);
  }
  return selected;
}

interface Result {
  scenario: string;
  category: string;
  op: string;
  framework: string;
  median: number;
  raw: number[];
}

interface MemoryResult {
  category: string;
  op: string;
  framework: string;
  /** Median heap usage after create (KB) */
  createKB: number;
  /** Median heap retained after destroy (KB) — lower = better cleanup */
  retainedKB: number;
}

async function main() {
  const scenarios = selectScenarios(SCENARIOS);
  const memoryScenarios = MEM_ITERATIONS > 0 ? selectScenarios(MEMORY_SCENARIOS, true) : [];

  console.log('\nPurity Comprehensive Benchmark');
  console.log(`Frameworks: ${FRAMEWORKS.join(', ')}`);
  console.log(
    `Scenarios: ${scenarios.length} pages, ${scenarios.reduce((s, sc) => s + sc.ops.length, 0)} operations`,
  );
  console.log(
    `Warmup: ${WARMUP} | Iterations: ${ITERATIONS} | Drop: fastest ${DROP_OUTLIERS} + slowest ${DROP_OUTLIERS}\n`,
  );
  console.log('Primary metric: CPU + microtask flush + forced layout.\n');

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  });
  const allResults: Result[] = [];
  const memoryResults: MemoryResult[] = [];

  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.category}: ${scenario.page} ===`);

    for (const op of scenario.ops) {
      const fwResults: Record<string, number> = {};

      // Randomize framework order
      const fws = [...FRAMEWORKS];
      for (let j = fws.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [fws[j], fws[k]] = [fws[k], fws[j]];
      }

      for (const fw of fws) {
        const url = `${BASE}/apps/${fw}/${scenario.page}.html`;
        const page = await browser.newPage();

        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          const times: number[] = [];

          for (let i = 0; i < WARMUP + ITERATIONS; i++) {
            if (op.setup?.length) await runSetup(page, op.setup);
            await settle(page);
            const t = await measureSteps(page, op.steps);
            if (i >= WARMUP) times.push(t);
            await page.waitForTimeout(20);
          }

          const med = trimmedMedian(times, DROP_OUTLIERS);
          fwResults[fw] = med;
          allResults.push({
            scenario: scenario.page,
            category: scenario.category,
            op: op.name,
            framework: fw,
            median: med,
            raw: times,
          });
        } catch (err: any) {
          fwResults[fw] = -1;
          console.error(`  [${fw}] ${op.name}: ERROR — ${err.message}`);
        } finally {
          await page.close();
        }
      }

      const vals = FRAMEWORKS.map((fw) => ({ fw, ms: fwResults[fw] ?? -1 })).filter(
        (v) => v.ms >= 0,
      );
      const winner = vals.length ? vals.reduce((a, b) => (a.ms < b.ms ? a : b)).fw : '—';
      const line = FRAMEWORKS.map(
        (fw) => `${fw}: ${fwResults[fw] >= 0 ? `${fwResults[fw].toFixed(1)}ms` : 'ERR'}`,
      ).join(' | ');
      console.log(`  ${op.name}: ${line} → ${winner}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Memory benchmarks
  // ---------------------------------------------------------------------------
  if (MEM_ITERATIONS > 0) {
    console.log('\n\n=== Memory Benchmarks ===');
    console.log(`Iterations: ${MEM_ITERATIONS}\n`);
  }

  for (const scenario of memoryScenarios) {
    for (const op of scenario.ops) {
      const fwResults: Record<string, { createKB: number; retainedKB: number }> = {};

      for (const fw of FRAMEWORKS) {
        const url = `${BASE}/apps/${fw}/${scenario.page}.html`;
        const page = await browser.newPage();

        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          const createSamples: number[] = [];
          const retainedSamples: number[] = [];

          for (let i = 0; i < MEM_ITERATIONS; i++) {
            // Ensure clean state
            await runSetup(page, op.destroy);
            await settle(page);
            const baseline = await getHeapKB(page);

            // Create
            await runSetup(page, op.create);
            await settle(page);
            const afterCreate = await getHeapKB(page);

            // Destroy
            await runSetup(page, op.destroy);
            await settle(page);
            const afterDestroy = await getHeapKB(page);

            if (baseline >= 0) {
              createSamples.push(afterCreate - baseline);
              retainedSamples.push(afterDestroy - baseline);
            }
          }

          const medCreate = createSamples.length > 0 ? trimmedMedian(createSamples, 0) : -1;
          const medRetained = retainedSamples.length > 0 ? trimmedMedian(retainedSamples, 0) : -1;

          fwResults[fw] = { createKB: medCreate, retainedKB: medRetained };
          memoryResults.push({
            category: scenario.category,
            op: op.name,
            framework: fw,
            createKB: medCreate,
            retainedKB: medRetained,
          });
        } catch (err: any) {
          fwResults[fw] = { createKB: -1, retainedKB: -1 };
          console.error(`  [${fw}] ${op.name}: ERROR — ${err.message}`);
        } finally {
          await page.close();
        }
      }

      const line = FRAMEWORKS.map((fw) => {
        const r = fwResults[fw];
        if (!r || r.createKB < 0) return `${fw}: ERR`;
        return `${fw}: +${(r.createKB / 1024).toFixed(1)}MB / retained ${(r.retainedKB / 1024).toFixed(1)}MB`;
      }).join(' | ');
      console.log(`  ${op.name}: ${line}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Print final markdown table
  // ---------------------------------------------------------------------------
  console.log('\n\n## Full Results\n');
  const hdr = [
    'Category',
    'Operation',
    ...FRAMEWORKS.map((f) => f.charAt(0).toUpperCase() + f.slice(1)),
    'Winner',
  ];
  console.log(`| ${hdr.join(' | ')} |`);
  console.log(`|${hdr.map(() => '---').join('|')}|`);

  // Group by category
  let lastCategory = '';
  for (const scenario of scenarios) {
    for (const op of scenario.ops) {
      const cat = scenario.category === lastCategory ? '' : scenario.category;
      lastCategory = scenario.category;

      const vals = FRAMEWORKS.map((fw) => {
        const r = allResults.find(
          (x) => x.scenario === scenario.page && x.op === op.name && x.framework === fw,
        );
        return { fw: fw.charAt(0).toUpperCase() + fw.slice(1), ms: r?.median ?? -1 };
      });
      const valid = vals.filter((v) => v.ms >= 0);
      const winner = valid.length ? valid.reduce((a, b) => (a.ms < b.ms ? a : b)).fw : '—';
      const cells = vals.map((v) => (v.ms >= 0 ? `${v.ms.toFixed(1)}ms` : 'ERR'));
      console.log(`| ${cat} | ${op.name} | ${cells.join(' | ')} | **${winner}** |`);
    }
  }

  // ---------------------------------------------------------------------------
  // Print memory results table
  // ---------------------------------------------------------------------------
  if (memoryResults.length > 0) {
    console.log('\n\n## Memory Results\n');
    const memHdr = [
      'Operation',
      ...FRAMEWORKS.map((f) => `${f.charAt(0).toUpperCase() + f.slice(1)} (used)`),
      ...FRAMEWORKS.map((f) => `${f.charAt(0).toUpperCase() + f.slice(1)} (retained)`),
      'Best Cleanup',
    ];
    console.log(`| ${memHdr.join(' | ')} |`);
    console.log(`|${memHdr.map(() => '---').join('|')}|`);

    const memOps = [...new Set(memoryResults.map((r) => r.op))];
    for (const op of memOps) {
      const usedCells = FRAMEWORKS.map((fw) => {
        const r = memoryResults.find((x) => x.op === op && x.framework === fw);
        return r && r.createKB >= 0 ? `${(r.createKB / 1024).toFixed(1)}MB` : 'ERR';
      });
      const retainedCells = FRAMEWORKS.map((fw) => {
        const r = memoryResults.find((x) => x.op === op && x.framework === fw);
        return r && r.retainedKB >= 0 ? `${(r.retainedKB / 1024).toFixed(1)}MB` : 'ERR';
      });
      const retainedVals = FRAMEWORKS.map((fw) => {
        const r = memoryResults.find((x) => x.op === op && x.framework === fw);
        return { fw: fw.charAt(0).toUpperCase() + fw.slice(1), kb: r?.retainedKB ?? -1 };
      }).filter((v) => v.kb >= 0);
      const bestCleanup = retainedVals.length
        ? retainedVals.reduce((a, b) => (Math.abs(a.kb) < Math.abs(b.kb) ? a : b)).fw
        : '—';

      console.log(
        `| ${op} | ${usedCells.join(' | ')} | ${retainedCells.join(' | ')} | **${bestCleanup}** |`,
      );
    }
  }

  // Caveats
  console.log('\n### Notes\n');
  console.log(
    '- **Svelte computed-chain & diamond:** Svelte 5 `$derived()` is a compile-time rune and cannot be created dynamically. These scenarios use a `$effect` loop instead of 1000 actual reactive dependency nodes. Purity, Solid, and Vue create real reactive graphs for these tests, so Svelte results are not directly comparable.',
  );
  console.log(
    '- **Memory results:** Heap usage measured via `performance.memory.usedJSHeapSize` with forced GC. "Used" = heap delta after creation. "Retained" = heap delta after destroy — indicates memory not released (closer to 0 = better cleanup).',
  );

  console.log('\n✓ Benchmark complete.');
  await browser.close();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
