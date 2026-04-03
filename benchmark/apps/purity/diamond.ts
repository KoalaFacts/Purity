// Diamond dependency benchmark — Purity idiomatic version.
// Uses: state, compute, batch, html, mount. Zero vanilla JS for UI wiring.

import { batch, compute, html, mount, state, watch } from '@purity/core';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sources: ReturnType<typeof state<number>>[] = [];
let total: (() => number) | null = null;

const result = state('—');

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setup() {
  sources = [];
  const results: (() => number)[] = [];
  for (let i = 0; i < 1000; i++) {
    const a = state(i);
    const b = compute(() => a() * 2);
    const c = compute(() => a() * 3);
    const d = compute(() => b() + c());
    sources.push(a);
    results.push(d);
  }
  total = compute(() => {
    let s = 0;
    for (let i = 0; i < results.length; i++) s += results[i]();
    return s;
  });
  watch(() => {
    result(String(total!()));
  });
}

function updateAll() {
  batch(() => {
    for (let i = 0; i < sources.length; i++) {
      sources[i](((i + Math.random() * 100) | 0));
    }
  });
}

function updateOne() {
  if (sources.length > 0) sources[0](((Math.random() * 100) | 0));
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
      <div class="col-md-6"><h1>Purity (Diamond)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="setup" @click=${setup}>Setup 1000 Diamonds</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-all" @click=${updateAll}>Update All Sources</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-one" @click=${updateOne}>Update One Source</button>
        </div>
        ${hBtn('setup-diamonds', 'Setup', setup)}
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
