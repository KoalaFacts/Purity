// Computed chain benchmark — Purity idiomatic version.
// Uses: state, compute, html, mount. Zero vanilla JS for UI wiring.

import type { ComputedAccessor } from '@purity/core';
import { compute, html, mount, state, watch } from '@purity/core';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let source: ReturnType<typeof state<number>> | null = null;
let chain: ComputedAccessor<number>[] = [];

const result = state('—');
const isSetup = state(false);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setup() {
  source = state(0);
  chain = [];
  let prev: () => number = source;
  for (let i = 0; i < 1000; i++) {
    const p = prev;
    const c = compute(() => p() * 2 + 1);
    chain.push(c);
    prev = c;
  }
  watch(() => {
    result(String(chain[chain.length - 1]()));
  });
  isSetup(true);
}

function updateSource() {
  if (source) source((Math.random() * 100) | 0);
}

function updateSource10x() {
  if (source) {
    for (let i = 0; i < 10; i++) {
      source((Math.random() * 100) | 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Computed Chain)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="setup" @click=${setup}>Setup Chain (1000 levels)</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update" @click=${updateSource}>Update Source</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-10x" @click=${updateSource10x}>Update 10x</button>
        </div>
        ${hBtn('setup-chain', 'Setup', setup)}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Result display
// ---------------------------------------------------------------------------

function Result() {
  return html`<div id="result">${() => result()}</div>`;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
mount(Result, document.getElementById('result-container')!);
