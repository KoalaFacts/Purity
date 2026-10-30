import { component, css } from '@purityjs/core';
import { describe, expect, it } from 'vite-plus/test';
import { html, renderToString } from '../src/index.ts';
import { ensureSSRComponentRendererInstalled } from '../src/component.ts';
import { ssrElement } from '../src/runtime.ts';

describe('server component rendering', () => {
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
