import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disableHydrationTextRewrite,
  disableHydrationWarnings,
  enableHydrationTextRewrite,
  enableHydrationWarnings,
  html,
  hydrate,
  state,
} from '../src/index.ts';
import { tick } from './_helpers.ts';

describe('hydrate mismatch warnings (opt-in dev diagnostics)', () => {
  let host: HTMLElement;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    enableHydrationWarnings();
  });

  afterEach(() => {
    disableHydrationWarnings();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('warns when SSR sends a different element tag than the template expects', () => {
    // Template expects <p>, SSR sent <div>.
    host.innerHTML = '<div>x</div>';
    hydrate(host, () => html`<p>${'x'}</p>`);
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('Hydration mismatch');
    expect(msg).toContain('<p>');
    expect(msg).toContain('<div>');
  });

  it('warns when SSR omits the expression open marker', () => {
    // Template has a reactive slot but SSR sent plain text — no <!--[--> marker.
    host.innerHTML = '<p>plain</p>';
    const v = state('plain');
    hydrate(host, () => html`<p>${() => v()}</p>`);
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('expression-slot open marker');
  });

  it('warns when SSR sends a comment where text was expected', () => {
    // Template has a static text node "hi" inside <p>, SSR sent a comment.
    host.innerHTML = '<p><!--hi--></p>';
    hydrate(host, () => html`<p>hi${'expr'}</p>`);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain('expected text node');
  });

  it('does not warn when SSR markup matches the template exactly', () => {
    host.innerHTML = '<p><!--[-->hello<!--]--></p>';
    hydrate(host, () => html`<p>${'hello'}</p>`);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is silent when warnings are disabled', () => {
    disableHydrationWarnings();
    host.innerHTML = '<div>x</div>'; // mismatch — but we're not asking
    hydrate(host, () => html`<p>${'x'}</p>`);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns on nested-template tag mismatches too', async () => {
    // Outer expects <div><span>...</span></div>; SSR has <div><em>...</em></div>.
    host.innerHTML = '<div><!--[--><em><!--[-->Ada<!--]--></em><!--]--></div>';
    const name = state('Ada');
    hydrate(host, () => html`<div>${html`<span>${() => name()}</span>`}</div>`);
    await tick();
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain('<span>');
    expect(msg).toContain('<em>');
  });

  it('recovers after a structural mismatch by falling back to fresh mount', async () => {
    // SSR sent <p>plain</p> but template has a reactive expression — the
    // walker has no `<!--[-->` to consume and crashes on null.parentNode.
    // Hydration must catch and re-render the page fresh so the user keeps
    // a working DOM (just lossy for this render).
    host.innerHTML = '<p>plain</p>';
    const v = state('client-value');
    hydrate(host, () => html`<p>${() => v()}</p>`);
    await tick();
    // Warned + errored, but the DOM is the freshly-rendered client output.
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(host.textContent).toBe('client-value');
    // Reactivity wired up against the new tree.
    v('updated');
    await tick();
    expect(host.textContent).toBe('updated');
  });

  it('still recovers cleanly when warnings are disabled', async () => {
    disableHydrationWarnings();
    host.innerHTML = '<p>plain</p>';
    const v = state('client-value');
    hydrate(host, () => html`<p>${() => v()}</p>`);
    await tick();
    // No warnings — but the recovery still happens via the top-level catch.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(host.textContent).toBe('client-value');
  });

  it('warns on silent text-content divergence (same shape, different bytes)', () => {
    // Structural shape matches: <p>TEXT${expr}</p>. But the SSR text
    // node says "Hello " and the template says "Hi ". With warnings on
    // the runtime helper compares the AST-supplied value to what's in
    // the DOM and surfaces the drift.
    host.innerHTML = '<p>Hello <!--[-->world<!--]--></p>';
    hydrate(host, () => html`<p>Hi ${'world'}</p>`);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain('text content differs');
    expect(msg).toContain('"Hi "');
    expect(msg).toContain('"Hello "');
    // SSR text is preserved (we explicitly don't rewrite static content).
    expect(host.textContent).toBe('Hello world');
  });

  it('does not warn when static text matches exactly', () => {
    host.innerHTML = '<p>Hi <!--[-->world<!--]--></p>';
    hydrate(host, () => html`<p>Hi ${'world'}</p>`);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ADR 0007 — opt-in static text-content rewriting on mismatch.
//
// Default behavior (above) is detect + warn but preserve SSR text. This block
// covers the new opt-in: enableHydrationTextRewrite() rewrites the SSR Text
// node's data to match the template's AST text on mismatch. Same node
// reference (no structural change), only the bytes change.
// ---------------------------------------------------------------------------

describe('hydrate text-rewrite on mismatch (opt-in)', () => {
  let host: HTMLElement;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    disableHydrationTextRewrite();
    disableHydrationWarnings();
    warnSpy.mockRestore();
  });

  it('rewrites the SSR text node when mismatch is detected (silent by default)', () => {
    enableHydrationTextRewrite();
    host.innerHTML = '<p>Hello <!--[-->world<!--]--></p>';
    const ssrText = host.querySelector('p')!.firstChild as Text;
    expect(ssrText.data).toBe('Hello ');

    hydrate(host, () => html`<p>Hi ${'world'}</p>`);

    // Same node reference — only the bytes were rewritten.
    expect(host.querySelector('p')!.firstChild).toBe(ssrText);
    expect(ssrText.data).toBe('Hi ');
    expect(host.textContent).toBe('Hi world');
    // Silent rewrite by default.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('preserves SSR text when rewrite is disabled (default)', () => {
    host.innerHTML = '<p>Hello <!--[-->world<!--]--></p>';
    hydrate(host, () => html`<p>Hi ${'world'}</p>`);
    // No rewrite — original SSR text persists.
    expect(host.textContent).toBe('Hello world');
  });

  it('rewrite + warnings together: rewrites AND logs', () => {
    enableHydrationTextRewrite();
    enableHydrationWarnings();
    host.innerHTML = '<p>Hello <!--[-->world<!--]--></p>';
    hydrate(host, () => html`<p>Hi ${'world'}</p>`);
    expect(host.textContent).toBe('Hi world');
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain('text content differs');
    expect(msg).toContain('rewritten');
  });

  it('does not touch text when SSR matches the template', () => {
    enableHydrationTextRewrite();
    host.innerHTML = '<p>Hi <!--[-->world<!--]--></p>';
    const ssrText = host.querySelector('p')!.firstChild as Text;
    hydrate(host, () => html`<p>Hi ${'world'}</p>`);
    expect(ssrText.data).toBe('Hi ');
    expect(host.textContent).toBe('Hi world');
  });

  it('reactive bindings keep working alongside a static text rewrite', async () => {
    enableHydrationTextRewrite();
    host.innerHTML = '<p>Old <!--[-->X<!--]--></p>';
    const v = state('first');
    hydrate(host, () => html`<p>New ${() => v()}</p>`);
    // Static text rewritten on hydrate.
    expect(host.textContent).toBe('New first');
    v('second');
    await tick();
    // Reactive update flowed through to the slot text.
    expect(host.textContent).toBe('New second');
  });
});
