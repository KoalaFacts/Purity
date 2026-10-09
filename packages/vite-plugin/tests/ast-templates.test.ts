import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const IMPORT = "import { html } from '@purityjs/core';\n";
// A mixed interpolated attribute is a compile error, so a template-looking
// example that is compiled anywhere would throw. Non-template text must not.
const MIXED = 'html`<a title="x ${v}">y</a>`';

describe('AOT template discovery is AST based', () => {
  const plugin: any = purity();

  it.each([false, true])('leaves html`` text in a JSDoc comment alone (ssr=%s)', (ssr) => {
    const code = `${IMPORT}/**\n * Example: ${MIXED}\n */\nexport const view = () => 1;\n`;
    expect(plugin.transform(code, 'dep.ts', { ssr })).toBeNull();
  });

  it.each([false, true])('leaves html`` text in a line comment alone (ssr=%s)', (ssr) => {
    const code = `${IMPORT}// ${MIXED}\nexport const view = () => 1;\n`;
    expect(plugin.transform(code, 'dep.ts', { ssr })).toBeNull();
  });

  it.each([false, true])('leaves html`` text inside string literals alone (ssr=%s)', (ssr) => {
    const code = `${IMPORT}export const a = '${MIXED}';\nexport const b = "${MIXED}";\n`;
    expect(plugin.transform(code, 'dep.ts', { ssr })).toBeNull();
  });

  it.each([false, true])('compiles a real template after a comment (ssr=%s)', (ssr) => {
    const code = `${IMPORT}/* ${MIXED} */\nexport const view = (x) => html\`<p>\${x}</p>\`;\n`;
    const result = plugin.transform(code, 'app.ts', { ssr });
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('html`<p>');
    // The comment text survives untouched; only the real template is replaced.
    expect(result.code).toContain(`/* ${MIXED} */`);
  });

  it.each([false, true])(
    'compiles a template nested in another template literal (ssr=%s)',
    (ssr) => {
      const code = `${IMPORT}export const s = (x) => \`prefix \${html\`<b>\${x}</b>\`}\`;\n`;
      const result = plugin.transform(code, 'app.ts', { ssr });
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('html`<b>');
      expect(result.code).toContain('prefix');
    },
  );

  it.each([false, true])('compiles a template in TypeScript with generics (ssr=%s)', (ssr) => {
    const code = `${IMPORT}export const f = <T,>(v: T) => html\`<p>\${v}</p>\`;\n`;
    const result = plugin.transform(code, 'app.ts', { ssr });
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('html`<p>');
  });

  it('compiles templates in a .js file that also contains JSX', () => {
    const code = `${IMPORT}export const view = (x) => html\`<p>\${x}</p>\`;
export const el = <div />;
`;
    const result = plugin.transform(code, 'app.js');
    expect(result).not.toBeNull();
    expect(result.code).not.toContain('html`<p>');
  });

  it('still strips the html import only when every real template compiled', () => {
    const code = `${IMPORT}export const view = () => html\`<p>ok</p>\`;\n`;
    const result = plugin.transform(code, 'app.ts');
    expect(result.code).not.toContain("import { html } from '@purityjs/core'");
  });

  it('a file whose only html text is in comments does not change', () => {
    const code = `${IMPORT}// ${MIXED}\nexport const x = 1;\n`;
    expect(plugin.transform(code, 'dep.ts')).toBeNull();
  });
});
