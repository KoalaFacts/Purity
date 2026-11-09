// Playwright's engines for every browser check and scanner in this repo.
// `CHROMIUM_PATH` points Chromium at an installed browser when Playwright's
// pinned revision is absent (`Executable doesn't exist at …`), the same
// variable run-bench.ts, profile.ts, sanity.ts and memory-leak-check.ts read,
// so no revision folder has to be symlinked into PLAYWRIGHT_BROWSERS_PATH.
// An explicit `executablePath` passed to `launch()` still wins.
import { chromium as playwrightChromium, firefox, webkit } from 'playwright';
import type { BrowserType } from 'playwright';

export function withExecutablePath(
  engine: BrowserType,
  executablePath: string | undefined,
): BrowserType {
  if (!executablePath) return engine;
  return new Proxy(engine, {
    get(target, key) {
      if (key === 'launch')
        return (options?: Parameters<BrowserType['launch']>[0]) =>
          target.launch({ executablePath, ...options });
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const chromium = withExecutablePath(playwrightChromium, process.env.CHROMIUM_PATH);
export { firefox, webkit };
