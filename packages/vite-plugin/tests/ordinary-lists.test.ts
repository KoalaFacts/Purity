import { describe, expect, it } from 'vite-plus/test';
import { specializeOrdinaryLists } from '../src/ordinary-lists.ts';
import { purity } from '../src/index.ts';

describe('ordinary list specialization', () => {
  it('selects only directly called named imports and preserves other imports', () => {
    const source = `import { each as rows, state } from '@purityjs/core';
      const items = state([]);
      rows(items, render);
      rows(items, render, item => item.id);`;
    const result = specializeOrdinaryLists(source, '/app/list.ts');
    expect(result).toContain("import { state } from '@purityjs/core'");
    expect(result).toContain("import { each as rows } from '@purityjs/core/list-runtime'");
    expect(result).toContain('rows(items, render, item => item.id)');
  });

  it.each([
    'each(items, render, { virtual: true })',
    'each(items, render, key, options)',
    'each(items, render, key)',
    'each(...args)',
    'each?.(items, render)',
    'export { each }',
    'const callback = each',
    'function f(each) { return each(items, render) }',
    'const { each: local } = value; each(items, render)',
    "eval('each.length'); each(items, render)",
    'each(items, render); each(items, render, options)',
  ])('keeps uncertain or virtual use unchanged: %s', (use) => {
    expect(
      specializeOrdinaryLists(`import { each } from '@purityjs/core'; ${use}`, '/app/list.ts'),
    ).toBeNull();
  });

  it('uses decoded identifiers for escaped aliases and shadowing', () => {
    const imported = "import { each as r\\u006fws } from '@purityjs/core';";
    expect(specializeOrdinaryLists(`${imported} rows(items, render)`, '/app/list.ts')).toContain(
      'each as rows',
    );
    expect(
      specializeOrdinaryLists(
        `${imported} function f(r\\u006fws) { rows(items, render) }`,
        '/app/list.ts',
      ),
    ).toBeNull();
  });

  it('keeps bindings passed through JSX unchanged', () => {
    expect(
      specializeOrdinaryLists(
        "import { each as Rows } from '@purityjs/core'; Rows(items, render); const view = <Rows />;",
        '/app/list.tsx',
      ),
    ).toBeNull();
  });

  it('preserves namespace and type-only imports', () => {
    expect(
      specializeOrdinaryLists(
        "import * as p from '@purityjs/core'; p.each(items, render)",
        '/app/list.ts',
      ),
    ).toBeNull();
    expect(
      specializeOrdinaryLists(
        "import type { each } from '@purityjs/core'; each(items, render)",
        '/app/list.ts',
      ),
    ).toBeNull();
  });

  it('runs in client modules without templates and preserves server imports', () => {
    const source = "import { each } from '@purityjs/core'; each(items, render);";
    const plugin = purity({ hydratable: true, strictAot: false });
    const client = plugin.transform(source, '/app/list.ts');
    expect(client?.code).toContain('@purityjs/core/list-runtime');
    expect(client?.map.sourcesContent).toEqual([source]);
    expect(plugin.transform(source, '/app/list.ts', { ssr: true })).toBeNull();
  });

  it('preserves root aliases unless a dedicated runtime alias wins resolution', () => {
    const source = "import { each } from '@purityjs/core'; each(items, render);";
    const root = { find: '@purityjs/core', replacement: '/local/core/src/index.ts' };
    const runtime = {
      find: '@purityjs/core/list-runtime',
      replacement: '/local/core/src/control/list-runtime.ts',
    };
    const cases = [
      { alias: [], enabled: true },
      { alias: [root], enabled: false },
      { alias: [{ ...root, find: /^@purityjs\/core$/ }], enabled: false },
      { alias: [runtime, root], enabled: true },
      { alias: [root, runtime], enabled: false },
      { alias: [{ ...runtime, find: /^@purityjs\/core\/list-runtime$/g }, root], enabled: true },
    ];
    for (const { alias, enabled } of cases) {
      const plugin = purity({ hydratable: true, strictAot: false });
      plugin.configResolved({ root: '/app', resolve: { alias } });
      const result = plugin.transform(source, '/app/list.ts');
      if (enabled) expect(result?.code).toContain('@purityjs/core/list-runtime');
      else expect(result).toBeNull();
    }
  });
});
