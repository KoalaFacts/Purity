import { component, css } from '@purityjs/core';
import { describe, expect, it, vi } from 'vite-plus/test';
import { html, renderToString } from '../src/index.ts';
import { ensureSSRComponentRendererInstalled } from '../src/component.ts';
import { setSSRComponentRenderer, ssrElement } from '../src/runtime.ts';

describe('server component rendering', () => {
  it('rejects unsafe tag names before invoking the element renderer', () => {
    const renderer = vi.fn(() => null);
    setSSRComponentRenderer(renderer);
    try {
      expect(() => ssrElement('x-card><script>alert(1)</script><x-card', {}, '')).toThrow(
        /Invalid tag name/,
      );
      expect(renderer).not.toHaveBeenCalled();
    } finally {
      setSSRComponentRenderer(null);
    }
    expect(ssrElement('unknown-card', { title: 'safe' }, '')).toBe(
      '<unknown-card title="safe"></unknown-card>',
    );
  });

  it('retains safe host attributes and rejects injected attribute names', () => {
    component('test-ssr-safe-attrs', () => html`<span>x</span>` as unknown as Node);
    ensureSSRComponentRendererInstalled();
    const output = ssrElement(
      'test-ssr-safe-attrs',
      {
        title: 'ok',
        'data-x': 'y',
        'bad"><script>': 'evil',
      },
      '',
    );
    expect(output).toContain(' title="ok"');
    expect(output).toContain(' data-x="y"');
    expect(output).not.toContain('<script>');
    expect(output).not.toContain('bad');
  });
  it('renders a registered component with escaped props, slots, styles and focus delegation', async () => {
    component(
      'test-ssr-bridge',
      (props, slots) => {
        css`:host { color: red; }`;
        return html`<strong>${props.label}</strong>${slots.default()}` as unknown as Node;
      },
      { delegatesFocus: true },
    );

    const output = await renderToString(
      () => html`<test-ssr-bridge :label=${'<unsafe>'}>slot</test-ssr-bridge>`,
    );
    expect(output).toContain(
      '<test-ssr-bridge label="&lt;unsafe&gt;"><template shadowrootmode="open" shadowrootdelegatesfocus>',
    );
    expect(output).toContain('<style>:host { color: red; }</style>');
    expect(output).toContain('<strong><!--[-->&lt;unsafe&gt;<!--]--></strong>');
    expect(output).toContain('slot');
  });
});
