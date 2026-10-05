import { resource } from '@purityjs/core';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  html,
  renderToStream,
  renderToStreamResponse,
  renderToString,
  type RenderToStreamOptions,
} from '../src/index.ts';

const renderers = [
  { name: 'buffered', render: renderToString },
  {
    name: 'direct stream',
    render: async (view: () => unknown, options: RenderToStreamOptions) =>
      new Response(renderToStream(view, options)).text(),
  },
  {
    name: 'prepared stream',
    render: async (view: () => unknown, options: RenderToStreamOptions) =>
      new Response((await renderToStreamResponse(view, options)).body).text(),
  },
];

describe.each(renderers)('$name render option boundaries', ({ render }) => {
  it.each([
    '<!doctype html><script>globalThis.__purityDoctypeAttack=1</script>',
    '<script>globalThis.__purityDoctypeAttack=1</script>',
    '<!doctype html><img src=x onerror=attack()>',
    '<!doctype html><!doctype html>',
    '<!doctype html <script>>',
    '<!doctype>',
    'not a doctype',
  ])('rejects markup in doctype %s before creating work', async (doctype) => {
    const view = vi.fn(() => html`<p>unexpected</p>`);
    const signal = new AbortController().signal;
    const request = new Request('https://example.test/');
    const addExplicit = vi.spyOn(signal, 'addEventListener');
    const addRequest = vi.spyOn(request.signal, 'addEventListener');
    try {
      await expect(render(view, { doctype, signal, request })).rejects.toThrow(/invalid doctype/);
      expect(view).not.toHaveBeenCalled();
      expect(addExplicit).not.toHaveBeenCalled();
      expect(addRequest).not.toHaveBeenCalled();
    } finally {
      addExplicit.mockRestore();
      addRequest.mockRestore();
    }
  });

  it.each(['', '<!doctype html>', '<!DOCTYPE html>', '<!DoCtYpE html>'])(
    'preserves allowed doctype %s',
    async (doctype) => {
      const result = await render(() => html`<main>ready</main>`, { doctype });
      expect(result.startsWith(doctype + '<main>ready</main>')).toBe(true);
      if (doctype) expect(result.split(doctype)).toHaveLength(2);
    },
  );

  it('rejects nonce injection before creating work', async () => {
    const view = vi.fn(() => html`<p>unexpected</p>`);
    await expect(render(view, { nonce: 'x"><script>attack()</script>' })).rejects.toThrow(
      /invalid CSP nonce/,
    );
    expect(view).not.toHaveBeenCalled();
  });

  it('snapshots validated options before user code can change them', async () => {
    const options = { doctype: '<!doctype html>', nonce: 'safe_nonce' };
    const result = await render(() => {
      options.doctype = '<script>globalThis.__purityDoctypeAttack=1</script>';
      options.nonce = 'x" onload="attack()';
      const data = resource(() => Promise.resolve('ready'));
      return html`<p>${() => data()}</p>`;
    }, options);
    expect(result.startsWith('<!doctype html>')).toBe(true);
    expect(result).toContain('nonce="safe_nonce"');
    expect(result).not.toContain('__purityDoctypeAttack');
    expect(result).not.toContain('onload=');
  });
});
