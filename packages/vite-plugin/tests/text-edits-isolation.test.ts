import { spawnSync } from 'node:child_process';
import { expect, it } from 'vite-plus/test';

it('loads and runs the source-map editor without any other module', () => {
  const entry = new URL('../src/text-edits.ts', import.meta.url).href;
  const script = `
    import { registerHooks } from 'node:module';
    const entry = ${JSON.stringify(entry)};
    let loads = 0;
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier !== entry) throw Error('Unexpected dependency: ' + specifier);
        return next(specifier, context);
      },
      load(url, context, next) {
        loads++;
        return next(url, context);
      },
    });
    const { applyEdits, buildLineStarts } = await import(entry);
    const source = 'a\\rREMOVE\\nb';
    const result = applyEdits(source, [{ start: 2, end: 8, out: '' }], buildLineStarts(source), 'test.ts');
    console.log(JSON.stringify({ loads, code: result.code, lines: result.map.mappings.split(';').length }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toEqual({ loads: 1, code: 'a\r\nb', lines: 2 });
});
