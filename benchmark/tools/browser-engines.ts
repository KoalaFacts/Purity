import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

// CI always exercises every engine. Local callers can explicitly select an
// available engine without attempting a known-blocked browser installation.
const engines = { chromium, firefox, webkit };
const args = process.argv.slice(2);
assert(args.length <= 1, 'Expected at most one browser name');
const selected = args[0] ?? 'all';
assert(selected === 'all' || Object.hasOwn(engines, selected), 'Unknown browser');
assert(!process.env.CI || selected === 'all', 'CI must run all three browsers');
export const browserEngines = Object.entries(engines).filter(
  ([name]) => selected === 'all' || name === selected,
);
