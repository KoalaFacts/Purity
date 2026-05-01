// Computed chain benchmark — Purity idiomatic version.
// Uses: state, compute, html, mount. Zero vanilla JS for UI wiring.

import type { ComputedAccessor } from '@purityjs/core';
import { compute, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let source: ReturnType<typeof state<number>> | null = null;
let chain: ComputedAccessor<number>[] = [];

const result = state('—');
const isSetup = state(false);
const MOD = 1_000_000_007;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setup(levels = 1000) {
  source = state(0);
  chain = [];
  let prev: () => number = source;
  for (let i = 0; i < levels; i++) {
    const p = prev;
    const c = compute(() => (p() * 2 + 1) % MOD);
    chain.push(c);
    prev = c;
  }
  result(String(readChain()));
  isSetup(true);
}

function readChain() {
  let value = 0;
  for (let i = 0; i < chain.length; i++) value = chain[i]();
  return value;
}

function updateSource() {
  if (source) {
    source((Math.random() * 100) | 0);
    result(String(readChain()));
  }
}

function updateSource10x() {
  if (source) {
    for (let i = 0; i < 10; i++) {
      source((Math.random() * 100) | 0);
    }
    result(String(readChain()));
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
          <button type="button" class="btn btn-primary btn-block" id="setup" @click=${() => setup(1000)}>Setup Chain (1000 levels)</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update" @click=${updateSource}>Update Source</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-10x" @click=${updateSource10x}>Update 10x</button>
        </div>
        ${hBtn('setup-10', 'Setup 10', () => setup(10))}
        ${hBtn('setup-100', 'Setup 100', () => setup(100))}
        ${hBtn('setup-chain', 'Setup 1000', () => setup(1000))}
        ${hBtn('setup-10k', 'Setup 10k', () => setup(10000))}
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
