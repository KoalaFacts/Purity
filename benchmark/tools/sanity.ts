// Functional sanity check across the Purity bench apps. Loads each page,
// exercises typical interactions, asserts the rendered DOM looks right.
// Catches the kind of regressions a perf change can cause but a benchmark
// can't see (e.g. all rows showing "undefined" still counts as 10k <tr>s).

import { type ConsoleMessage, chromium, type Page } from 'playwright';

const BASE = 'http://localhost:4173/Purity/apps/purity';

// Some bench buttons are visually hidden (style="display:none") so the
// runner can trigger actions without UI clutter. Match run-bench.ts and
// invoke .click() through the DOM directly.
async function clk(page: Page, selector: string): Promise<void> {
  await page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) throw new Error(`selector not found: ${s}`);
    el.click();
  }, selector);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

interface Probe {
  name: string;
  url: string;
  steps: (page: Page) => Promise<unknown>;
  // Optional set of substrings expected to be PRESENT in the result JSON.
  // Failing one of these flags the probe red.
  expect?: RegExp[];
}

const probes: Probe[] = [
  {
    name: 'index — Create 10 renders distinct id+label',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-10');
      const trCount = await page.locator('tbody tr').count();
      const firstRow = (await page.locator('tbody tr').first().textContent())?.trim();
      const lastRow = (await page.locator('tbody tr').last().textContent())?.trim();
      return { trCount, firstRow, lastRow };
    },
    // Each row's textContent concatenates td contents without separators,
    // so the id digits run straight into the label words. Looks like
    // "1unsightly pink burger" — id followed by 3 label tokens.
    expect: [/"trCount":10\b/, /"firstRow":"\d+\w+\s\w+\s\w+/],
  },
  {
    name: 'index — Append preserves existing rows + adds new',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-10');
      const firstAfterCreate = (await page.locator('tbody tr').first().textContent())?.trim();
      await clk(page, '#add-10');
      const trCount = await page.locator('tbody tr').count();
      const firstAfterAppend = (await page.locator('tbody tr').first().textContent())?.trim();
      return {
        trCount,
        firstAfterCreate,
        firstAfterAppend,
        sameFirstRow: firstAfterCreate === firstAfterAppend,
      };
    },
    expect: [/"trCount":20\b/, /"sameFirstRow":true\b/],
  },
  {
    name: 'index — Replace yields entirely new rows',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-100');
      const beforeFirst = (await page.locator('tbody tr').first().textContent())?.trim();
      await clk(page, '#run-100');
      const afterFirst = (await page.locator('tbody tr').first().textContent())?.trim();
      const trCount = await page.locator('tbody tr').count();
      return { trCount, beforeFirst, afterFirst, changed: beforeFirst !== afterFirst };
    },
    expect: [/"trCount":100\b/, /"changed":true\b/],
  },
  {
    name: 'index — Update every 10th appends "!!!"',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-100');
      await clk(page, '#update');
      const after1stRow = (await page.locator('tbody tr').first().textContent())?.trim();
      const after2ndRow = (await page.locator('tbody tr').nth(1).textContent())?.trim();
      const after10thRow = (await page.locator('tbody tr').nth(10).textContent())?.trim();
      return { after1stRow, after2ndRow, after10thRow };
    },
    // 1st row updated → ends in "!!!"; 2nd row not updated → no "!!!"; 10th
    // row not updated either (update() touches every 10th = indices 0,10,20)
    // so the 10th index (nth(10)) IS updated.
    expect: [/"after1stRow":".*!!!/, /"after10thRow":".*!!!/],
  },
  {
    name: 'index — Click .lbl marks row .danger',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-10');
      await page.locator('tbody tr').nth(2).locator('a.lbl').click();
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const dangerCount = await page.locator('tbody tr.danger').count();
      const dangerText = (await page.locator('tbody tr.danger').textContent())?.trim();
      return { dangerCount, dangerText };
    },
    expect: [/"dangerCount":1\b/, /"dangerText":"\d+/],
  },
  {
    name: 'index — Remove a row drops its DOM',
    url: `${BASE}/index.html`,
    steps: async (page) => {
      await clk(page, '#run-10');
      const before = await page.locator('tbody tr').count();
      const removedId = (
        await page.locator('tbody tr').nth(4).locator('td').first().textContent()
      )?.trim();
      // Dispatch the click through the DOM directly — Playwright's visibility
      // checks fail on the icon-wrapping anchor in headless. The bench's
      // event delegation picks up the click either way.
      await page.evaluate(() => {
        (
          document.querySelectorAll('tbody tr')[4]?.querySelector('a.remove') as HTMLElement | null
        )?.click();
      });
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const after = await page.locator('tbody tr').count();
      const idsLeft = await page.locator('tbody tr td:first-child').allTextContents();
      return { before, after, removedId, idStillThere: idsLeft.includes(removedId ?? '') };
    },
    expect: [/"before":10\b/, /"after":9\b/, /"idStillThere":false\b/],
  },
  {
    name: 'cart — add items + increment qty + total updates',
    url: `${BASE}/cart.html`,
    steps: async (page) => {
      await clk(page, '#add-1');
      await clk(page, '#add-1');
      await clk(page, '#add-1');
      const trCount = await page.locator('tbody tr').count();
      const itemCountBefore = await page.locator('#item-count').textContent();
      const totalBefore = await page.locator('#total').textContent();
      const firstQtyBefore = await page
        .locator('tbody tr')
        .first()
        .locator('td')
        .nth(2)
        .textContent();
      await clk(page, '#increment-all');
      const totalAfter = await page.locator('#total').textContent();
      const firstQtyAfter = await page
        .locator('tbody tr')
        .first()
        .locator('td')
        .nth(2)
        .textContent();
      return {
        trCount,
        itemCountBefore,
        totalBefore,
        totalAfter,
        firstQtyBefore,
        firstQtyAfter,
        totalIncreased: parseFloat(totalAfter ?? '0') > parseFloat(totalBefore ?? '0'),
        qtyIncreased:
          parseInt(firstQtyAfter ?? '0', 10) === parseInt(firstQtyBefore ?? '0', 10) + 1,
      };
    },
    expect: [
      /"trCount":3\b/,
      /"totalIncreased":true\b/,
      /"qtyIncreased":true\b/,
      /"itemCountBefore":"3"/,
    ],
  },
  {
    name: 'binding — two-way bind reflects user input',
    url: `${BASE}/binding.html`,
    steps: async (page) => {
      // Click the visible "Create 100 Fields" button.
      await clk(page, '#create-100');
      const inputCount = await page.locator('input').count();
      // Type into the first input
      await page.locator('input').first().fill('hello-from-test');
      const firstAfter = await page.locator('input').first().inputValue();
      // Update-all writes "updated-N" into every signal — including our
      // first one, so the input value should change underneath. That tests
      // that the bind direction signal→input still works after we typed.
      await clk(page, '#update-all');
      const firstAfterUpdate = await page.locator('input').first().inputValue();
      return {
        inputCount,
        firstAfter,
        firstAfterUpdate,
        signalDrivesInput: firstAfterUpdate.startsWith('updated-'),
      };
    },
    expect: [/"firstAfter":"hello-from-test"/, /"signalDrivesInput":true\b/],
  },
  {
    name: 'conditional — toggle visibility flips DOM',
    url: `${BASE}/conditional.html`,
    steps: async (page) => {
      await clk(page, '#populate');
      const before = (await page.locator('body').textContent())?.length ?? 0;
      await clk(page, '#toggle');
      const after = (await page.locator('body').textContent())?.length ?? 0;
      await clk(page, '#toggle');
      const afterToggleBack = (await page.locator('body').textContent())?.length ?? 0;
      return {
        before,
        after,
        afterToggleBack,
        toggleHides: after < before,
        toggleRestores: afterToggleBack === before,
      };
    },
    expect: [/"toggleHides":true\b/, /"toggleRestores":true\b/],
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m: ConsoleMessage) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

let pass = 0;
let fail = 0;

for (const probe of probes) {
  errors.length = 0;
  await page.goto(probe.url, { waitUntil: 'networkidle' });
  // The bench's favicon 404 is noise we don't care about.
  const realErrors = (): string[] => errors.filter((e) => !/Failed to load resource.*404/.test(e));

  let result: unknown;
  let probeError: string | null = null;
  try {
    result = await probe.steps(page);
  } catch (e) {
    probeError = (e as Error).message;
  }

  const json = JSON.stringify(result);
  const looksUndef = /\bundefined\b|\bNaN\b/.test(json || '');
  const expectMisses = (probe.expect ?? []).filter((re) => !re.test(json || ''));
  const ok = !probeError && realErrors().length === 0 && !looksUndef && expectMisses.length === 0;

  console.log(`${ok ? '✓' : '✗'} ${probe.name}`);
  console.log(`    ${json}`);
  if (probeError) console.log(`    !!! ${probeError}`);
  if (realErrors().length) console.log(`    !!! errors: ${realErrors().join('; ')}`);
  if (looksUndef) console.log(`    !!! 'undefined' or NaN in rendered output`);
  if (expectMisses.length) console.log(`    !!! expectations missed: ${expectMisses.join(', ')}`);

  if (ok) pass++;
  else fail++;
}

console.log('');
console.log(`functional sanity: ${pass}/${pass + fail} passed`);

await browser.close();
process.exit(fail > 0 ? 1 : 0);
