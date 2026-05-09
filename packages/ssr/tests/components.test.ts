import { component, css, slot, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html, renderToString } from '../src/index.ts';

// Each test registers a component with a unique static tag so the parser can
// see the tag name as a literal in the template. Purity's parser doesn't
// support dynamic tag interpolation (`<${tag}>`), so we build templates with
// fixed tags per test.

describe('component SSR — Declarative Shadow DOM', () => {
  it('wraps render output in <template shadowrootmode="open">', async () => {
    component('ssr-card-1', () => html`<div>hi</div>`);
    const out = await renderToString(() => html`<ssr-card-1></ssr-card-1>`);
    expect(out).toBe(
      '<ssr-card-1><template shadowrootmode="open"><div>hi</div></template></ssr-card-1>',
    );
  });

  it('renders default slot content', async () => {
    component('ssr-card-2', (_props, { default: body }) => html`<div>${body()}</div>`);
    const out = await renderToString(() => html`<ssr-card-2><p>slot body</p></ssr-card-2>`);
    expect(out).toBe(
      '<ssr-card-2><template shadowrootmode="open"><div><!--[--><p>slot body</p><!--]--></div></template></ssr-card-2>',
    );
  });

  it('renders empty slot as null', async () => {
    component('ssr-card-3', (_props, { default: body }) => html`<div>${body()}</div>`);
    const out = await renderToString(() => html`<ssr-card-3></ssr-card-3>`);
    expect(out).toBe(
      '<ssr-card-3><template shadowrootmode="open"><div><!--[--><!--]--></div></template></ssr-card-3>',
    );
  });

  it('inlines scoped CSS inside the DSD template', async () => {
    component('ssr-card-4', () => {
      css`
        .x {
          color: red;
        }
      `;
      return html`<div class="x">styled</div>`;
    });
    const out = await renderToString(() => html`<ssr-card-4></ssr-card-4>`);
    expect(out).toContain('<style>');
    expect(out).toContain('.x {');
    // Style block is inside the DSD template, not after it.
    const tplStart = out.indexOf('<template shadowrootmode="open">');
    const tplEnd = out.indexOf('</template>');
    expect(out.indexOf('<style>')).toBeGreaterThan(tplStart);
    expect(out.indexOf('</style>')).toBeLessThan(tplEnd);
  });

  it('captures multiple css() calls into a single <style> block', async () => {
    component('ssr-card-5', () => {
      css`
        .a {
          color: red;
        }
      `;
      css`
        .b {
          color: blue;
        }
      `;
      return html`<div></div>`;
    });
    const out = await renderToString(() => html`<ssr-card-5></ssr-card-5>`);
    expect(out).toContain('.a {');
    expect(out).toContain('.b {');
    expect(out.match(/<style>/g)?.length).toBe(1);
  });

  it('falls back to plain custom-element markup for unregistered tags', async () => {
    const out = await renderToString(
      () => html`<ssr-unregistered><span>child</span></ssr-unregistered>`,
    );
    expect(out).toBe('<ssr-unregistered><span>child</span></ssr-unregistered>');
    expect(out).not.toContain('shadowrootmode');
  });

  it('passes typed props (functions resolved once)', async () => {
    component<{ count: number }>('ssr-counter-1', ({ count }) => html`<p>${count}</p>`);
    const c = state(42);
    const out = await renderToString(() => html`<ssr-counter-1 :count=${c}></ssr-counter-1>`);
    expect(out).toContain('<!--[-->42<!--]-->');
  });

  it('renders the resolved attribute on the host element', async () => {
    component<{ label: string }>('ssr-labeled-1', ({ label }) => html`<i>${label}</i>`);
    const out = await renderToString(
      () => html`<ssr-labeled-1 :label=${'tag-label'}></ssr-labeled-1>`,
    );
    expect(out).toContain('<ssr-labeled-1 label="tag-label">');
  });

  it('skips event attributes — server has no listeners', async () => {
    component('ssr-button-1', () => html`<button>click me</button>`);
    const handler = () => {};
    const out = await renderToString(() => html`<ssr-button-1 @click=${handler}></ssr-button-1>`);
    expect(out).not.toContain('click=');
    expect(out).not.toContain('@click');
  });

  it('passes static attributes through as host attributes', async () => {
    component<{ title: string }>('ssr-headed-1', ({ title }) => html`<h2>${title}</h2>`);
    const out = await renderToString(
      () => html`<ssr-headed-1 :title=${'Hello'} class="card"></ssr-headed-1>`,
    );
    expect(out).toContain('title="Hello"');
    expect(out).toContain('class="card"');
  });

  it('supports slot() called standalone inside the render fn', async () => {
    component('ssr-section-1', () => {
      const body = slot();
      return html`<section>${body()}</section>`;
    });
    const out = await renderToString(() => html`<ssr-section-1><em>x</em></ssr-section-1>`);
    expect(out).toBe(
      '<ssr-section-1><template shadowrootmode="open"><section><!--[--><em>x</em><!--]--></section></template></ssr-section-1>',
    );
  });

  it('supports nested registered components', async () => {
    component('ssr-leaf-1', () => html`<span>leaf</span>`);
    component('ssr-branch-1', () => html`<div><ssr-leaf-1></ssr-leaf-1></div>`);
    const out = await renderToString(() => html`<ssr-branch-1></ssr-branch-1>`);
    // Outer DSD wraps inner DSD.
    expect(out).toContain(
      '<ssr-branch-1><template shadowrootmode="open"><div><ssr-leaf-1><template shadowrootmode="open"><span>leaf</span></template></ssr-leaf-1></div></template></ssr-branch-1>',
    );
  });

  it('renders multiple instances independently', async () => {
    component<{ n: number }>('ssr-cell-1', ({ n }) => html`<td>${n}</td>`);
    const out = await renderToString(
      () => html`
        <tr>
          <ssr-cell-1 :n=${1}></ssr-cell-1>
          <ssr-cell-1 :n=${2}></ssr-cell-1>
          <ssr-cell-1 :n=${3}></ssr-cell-1>
        </tr>
      `,
    );
    expect(out).toContain('<!--[-->1<!--]-->');
    expect(out).toContain('<!--[-->2<!--]-->');
    expect(out).toContain('<!--[-->3<!--]-->');
    expect(out.match(/shadowrootmode/g)?.length).toBe(3);
  });
});
