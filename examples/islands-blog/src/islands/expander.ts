// component()-rooted island — demonstrates the Declarative Shadow DOM
// hydration path described in ADR 0005 + 0038.
//
// What's different from counter.ts / like.ts:
//   - The island's view function returns a Custom Element (<demo-expander>)
//     instead of a plain `html``.
//   - SSR emits the DSD template shape (`<template shadowrootmode="open">
//     …</template>`) inside the custom element, with the scoped <style>
//     block from css`` inlined into the shadow.
//   - On the client, importing this file (via the lazy chunk in
//     entry.client.ts) calls `customElements.define('demo-expander', …)`,
//     which auto-upgrades the SSR-rendered element. mountIslands detects
//     this and skips the explicit hydrate() call — the upgrade did the
//     work via connectedCallback.
//
// The component pattern below uses a default slot so the surrounding
// app.ts can pass arbitrary content per-instance. Each `<demo-expander>`
// gets its own `open` signal — per-instance state, no module-scope
// closure footgun.

import { component, css, html, island, slot, state } from '@purityjs/core';

component('demo-expander', () => {
  const open = state(false);
  const body = slot('default');

  // `css` registers scoped styles via side-effect; the return value is
  // unused (the styles are collected on the component context).
  void css`
    :host {
      display: block;
      margin: 1.25rem 0;
    }
    .card {
      border: 1px solid #e6e6e6;
      border-radius: 6px;
      background: #fafafa;
      padding: 0.5rem 1rem;
    }
    button {
      font: inherit;
      background: none;
      border: 0;
      padding: 0.35rem 0;
      cursor: pointer;
      color: #1a5fb4;
    }
    button:hover {
      text-decoration: underline;
    }
    .body[hidden] {
      display: none;
    }
    .body {
      padding-top: 0.5rem;
      border-top: 1px solid #e6e6e6;
      margin-top: 0.25rem;
    }
  `;

  return html`<div class="card">
    <button @click=${() => open.update((v) => !v)}>
      ${() => (open() ? '▾ Hide' : '▸ Show')} details
    </button>
    <div class="body" ?hidden=${() => !open()}>${body()}</div>
  </div>`;
});

const View = (): unknown => html`<demo-expander>
  <p>
    This card is a <strong>component-rooted island</strong> — a Custom Element rendered with
    Declarative Shadow DOM. The shadow content above (the toggle button and the surrounding box) was
    emitted at SSR time and is visible immediately, before any JavaScript runs.
  </p>
  <p>
    When this island's chunk loads, <code>customElements.define()</code> registers the
    <code>&lt;demo-expander&gt;</code> class. The browser <em>auto-upgrades</em> this existing
    element — no <code>hydrate()</code> call needed. The toggle button starts working without any
    DOM reshuffling.
  </p>
</demo-expander>`;

export const Expander = island(View, { hydrate: 'interact' });
