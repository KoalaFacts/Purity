// Diamond dependency benchmark — Purity idiomatic version.
// Uses: state, compute, html, mount. Zero vanilla JS for UI wiring.

import { compute, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sourceSets: ((value: number) => void)[] = [];
let results: (() => number)[] = [];

const resultNode = document.createElement('div');
resultNode.id = 'result';
const resultText = document.createTextNode('—');
resultNode.appendChild(resultText);
document.getElementById('result-container')!.appendChild(resultNode);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function setup(count = 1000) {
  sourceSets = [];
  results = [];
  for (let i = 0; i < count; i++) {
    const a = state(i);
    const b = compute(() => a.get() * 2);
    const c = compute(() => a.get() * 3);
    const d = compute(() => b() + c());
    sourceSets.push(a.set);
    results.push(d.get);
  }
  resultText.data = String(readTotal());
}

function readTotal() {
  let s = 0;
  for (let i = 0, len = results.length; i < len; i++) s += results[i]();
  return s;
}

function updateAll() {
  for (let i = 0, len = sourceSets.length; i < len; i++) {
    sourceSets[i](i + ((i * 17 + 23) % 100));
  }
  resultText.data = String(readTotal());
}

function updateOne() {
  if (sourceSets.length > 0) {
    sourceSets[0](23);
    resultText.data = String(readTotal());
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
      <div class="col-md-6"><h1>Purity (Diamond)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="setup" @click=${() => setup(1000)}>Setup 1000 Diamonds</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-all" @click=${updateAll}>Update All Sources</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="update-one" @click=${updateOne}>Update One Source</button>
        </div>
        ${hBtn('setup-10', 'Setup 10', () => setup(10))}
        ${hBtn('setup-100', 'Setup 100', () => setup(100))}
        ${hBtn('setup-diamonds', 'Setup 1000', () => setup(1000))}
        ${hBtn('setup-10k', 'Setup 10k', () => setup(10000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
