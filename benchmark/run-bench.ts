#!/usr/bin/env node
// Playwright orchestrator — runs each framework's scenario pages in headless
// Chromium, performs operations via button clicks, measures rendering time
// via double-rAF paint timing.
//
// Usage: cd benchmark && npm run build-prod && npx vite preview & node --import tsx run-bench.ts

import { chromium, type Page } from 'playwright';

const PORT = process.env.PORT || 4173;
const BASE = `http://localhost:${PORT}`;
const WARMUP = 3;
const ITERATIONS = parseInt(process.env.ITERATIONS || '7', 10);
const DROP_OUTLIERS = 1; // drop N fastest + N slowest before computing median
const FRAMEWORKS = ['purity', 'solid', 'svelte', 'vue'] as const;

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
  // === Rendering ===
  {
    page: 'index',
    category: 'Rendering',
    ops: [
      { name: 'Create 1,000 rows', setup: [{ action: '#clear' }], steps: [{ action: '#run' }] },
      {
        name: 'Create 10,000 rows',
        setup: [{ action: '#clear' }],
        steps: [{ action: '#runlots' }],
      },
      {
        name: 'Append 1,000 rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#add' }],
      },
      {
        name: 'Replace 1,000 rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#run' }],
      },
      {
        name: 'Update every 10th',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Swap rows',
        setup: [{ action: '#clear' }, { action: '#run' }],
        steps: [{ action: '#swaprows' }],
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
  // === Reactivity & Computed ===
  {
    page: 'filter',
    category: 'Computed',
    ops: [
      {
        name: 'Filter 10k (type "e")',
        setup: [{ action: '#populate' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'e' }],
      },
      {
        name: 'Filter 10k (type "ex")',
        setup: [{ action: '#populate' }, { action: '#clear-search' }],
        steps: [{ action: 'input#search', value: 'ex' }],
      },
      {
        name: 'Clear filter',
        setup: [{ action: '#populate' }, { action: 'input#search', value: 'fancy' }],
        steps: [{ action: '#clear-search' }],
      },
    ],
  },
  {
    page: 'sort',
    category: 'Computed',
    ops: [
      {
        name: 'Sort 1k by ID ↑',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-id' }],
      },
      {
        name: 'Sort 1k by ID ↓',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-id-desc' }],
      },
      {
        name: 'Sort 1k by label',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#sort-label' }],
      },
    ],
  },
  {
    page: 'computed-chain',
    category: 'Computed',
    ops: [
      {
        name: 'Computed chain (1000 levels)',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update' }],
      },
      {
        name: 'Computed chain 10x',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update-10x' }],
      },
    ],
  },
  {
    page: 'diamond',
    category: 'Computed',
    ops: [
      {
        name: 'Diamond (1000) update all',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Diamond (1000) update one',
        setup: [{ action: '#setup' }],
        steps: [{ action: '#update-one' }],
      },
    ],
  },
  // === Component Patterns ===
  {
    page: 'cart',
    category: 'Components',
    ops: [
      {
        name: 'Add 1000 cart items',
        setup: [{ action: '#clear-cart' }],
        steps: [{ action: '#add-1000' }],
      },
      {
        name: 'Increment all qty',
        setup: [{ action: '#clear-cart' }, { action: '#add-1000' }],
        steps: [{ action: '#increment-all' }],
      },
      {
        name: 'Clear cart (1000)',
        setup: [{ action: '#clear-cart' }, { action: '#add-1000' }],
        steps: [{ action: '#clear-cart' }],
      },
    ],
  },
  {
    page: 'conditional',
    category: 'Components',
    ops: [
      {
        name: 'Toggle 1k section (show)',
        setup: [{ action: '#populate' }],
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
      {
        name: 'Destroy 1k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-1k' }],
        steps: [{ action: '#destroy-all' }],
      },
      {
        name: 'Replace 1k components',
        setup: [{ action: '#destroy-all' }, { action: '#create-1k' }],
        steps: [{ action: '#replace' }],
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
  // === User Interaction ===
  {
    page: 'binding',
    category: 'Interaction',
    ops: [
      { name: 'Create 1000 bound inputs', setup: [], steps: [{ action: '#create-1000' }] },
      {
        name: 'Update all 1000 inputs',
        setup: [{ action: '#create-1000' }],
        steps: [{ action: '#update-all' }],
      },
      {
        name: 'Clear all 1000 inputs',
        setup: [{ action: '#create-1000' }],
        steps: [{ action: '#clear-all' }],
      },
    ],
  },
  {
    page: 'selection',
    category: 'Interaction',
    ops: [
      {
        name: 'Select all (1000)',
        setup: [{ action: '#populate' }, { action: '#deselect-all' }],
        steps: [{ action: '#select-all' }],
      },
      {
        name: 'Deselect all (1000)',
        setup: [{ action: '#populate' }, { action: '#select-all' }],
        steps: [{ action: '#deselect-all' }],
      },
      {
        name: 'Toggle all (1000)',
        setup: [{ action: '#populate' }],
        steps: [{ action: '#toggle-all' }],
      },
    ],
  },
  {
    page: 'ticker',
    category: 'Interaction',
    ops: [
      {
        name: 'Stock ticker (500 frames)',
        setup: [{ action: '#stop' }],
        steps: [{ action: '#run-500' }],
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
        if (input) {
          input.value = step.value || '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        const btn = document.querySelector(step.action) as HTMLElement;
        if (btn) btn.click();
      }
    }
    // Wait for framework processing + browser paint
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return performance.now() - t0;
  }, steps);
  return duration;
}

async function runSetup(page: Page, steps: Step[]): Promise<void> {
  for (const step of steps) {
    if (step.action.startsWith('input#')) {
      await page.fill(step.action.replace('input', ''), step.value || '');
    } else {
      await page.click(step.action);
    }
    await settle(page);
    if (step.delay) await page.waitForTimeout(step.delay);
  }
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

interface Result {
  scenario: string;
  category: string;
  op: string;
  framework: string;
  median: number;
  raw: number[];
}

async function main() {
  console.log('\nPurity Comprehensive Benchmark');
  console.log(`Frameworks: ${FRAMEWORKS.join(', ')}`);
  console.log(
    `Scenarios: ${SCENARIOS.length} pages, ${SCENARIOS.reduce((s, sc) => s + sc.ops.length, 0)} operations`,
  );
  console.log(
    `Warmup: ${WARMUP} | Iterations: ${ITERATIONS} | Drop: fastest ${DROP_OUTLIERS} + slowest ${DROP_OUTLIERS}\n`,
  );

  const browser = await chromium.launch({ headless: true });
  const allResults: Result[] = [];

  for (const scenario of SCENARIOS) {
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
          await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
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
  for (const scenario of SCENARIOS) {
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

  // Caveats
  console.log('\n### Notes\n');
  console.log(
    '- **Svelte computed-chain & diamond:** Svelte 5 `$derived()` is a compile-time rune and cannot be created dynamically. These scenarios use a `$effect` loop instead of 1000 actual reactive dependency nodes. Purity, Solid, and Vue create real reactive graphs for these tests, so Svelte results are not directly comparable.',
  );

  console.log('\n✓ Benchmark complete.');
  await browser.close();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
