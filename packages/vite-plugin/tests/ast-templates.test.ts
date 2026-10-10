import { describe, expect, it, vi } from 'vite-plus/test';
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

  describe('container submodules (single-file components)', () => {
    const vuePlugin: any = purity({ include: ['.vue', '.svelte', '.ts', '.tsx', '.js', '.jsx'] });
    // Container plugins such as @vitejs/plugin-vue hand purity each script as a
    // pure-JS virtual module with its language in the `lang.*` query.
    const SUB = 'Card.vue?vue&type=script&setup=true&lang.ts';

    it('compiles html`` in a container script submodule', () => {
      const code = `${IMPORT}export const view = (x: string) => html\`<p>\${x}</p>\`;\n`;
      const result = vuePlugin.transform(code, SUB);
      expect(result).not.toBeNull();
      expect(result.code).not.toContain('html`<p>');
    });

    it('ignores html`` text in a comment of a container script submodule', () => {
      const code = `${IMPORT}// ${MIXED}\nexport const view = (x) => html\`<p>\${x}</p>\`;\n`;
      const result = vuePlugin.transform(code, SUB);
      expect(result).not.toBeNull();
      expect(result.code).toContain(`// ${MIXED}`);
      expect(result.code).not.toContain('html`<p>');
    });

    it('compiles each script submodule of one container independently', () => {
      const a = vuePlugin.transform(`${IMPORT}export const a = () => html\`<i>a</i>\`;\n`, SUB);
      const b = vuePlugin.transform(
        `${IMPORT}export const b = () => html\`<u>b</u>\`;\n`,
        'Card.vue?vue&type=script&lang.ts',
      );
      expect(a.code).toContain('__purity_renderCompiled__');
      expect(b.code).toContain('__purity_renderCompiled__');
      expect(a.code).not.toContain('html`<i>');
      expect(b.code).not.toContain('html`<u>');
    });

    it('does not compile templates in a raw container', () => {
      // The raw file has markup and a script with a generic attribute and a
      // `</scripture>` string. Raw containers are never parsed by purity.
      const raw = [
        '<template><p>markup</p></template>',
        '<script lang="ts" generic="T extends Record<string, unknown>">',
        IMPORT.trim(),
        "const s = '</scripture>';",
        'export const view = () => html`<p>x</p>`;',
        '</script>',
      ].join('\n');
      expect(vuePlugin.transform(raw, 'Raw.vue')).toBeNull();
    });

    it('warns once per container extension about a raw container with html``', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        vuePlugin.transform(
          `<script>${IMPORT.trim()} const v = html\`<p>x</p>\`;</script>`,
          'One.svelte',
        );
        vuePlugin.transform(
          `<script>${IMPORT.trim()} const v = html\`<p>x</p>\`;</script>`,
          'Two.svelte',
        );
        const notices = warn.mock.calls.filter((c) => String(c[0]).includes('raw container'));
        expect(notices.length).toBe(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('leaves a container with no html`` unchanged', () => {
      expect(vuePlugin.transform('<template><p>x</p></template>', 'Plain.vue')).toBeNull();
    });
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
