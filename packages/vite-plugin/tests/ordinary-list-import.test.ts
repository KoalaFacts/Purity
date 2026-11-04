import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

describe('ordinary list imports', () => {
  it('leaves a module without templates unchanged', () => {
    const source = "import { each } from '@purityjs/core'; each(items, render);";
    const plugin = purity({ hydratable: true, strictAot: false });
    expect(plugin.transform(source, '/app/list.ts')).toBeNull();
  });

  it('keeps the original core import while compiling templates', () => {
    const source =
      "import { each } from '@purityjs/core'; import { html } from '@purityjs/core/jit'; const view = html`<div>${each(items, render)}</div>`;";
    const plugin = purity({ hydratable: true });
    const result = plugin.transform(source, '/app/list.ts');
    expect(result?.code).toContain("import { each } from '@purityjs/core'");
    expect(result?.code).not.toContain('@purityjs/core/list-runtime');
  });
});
