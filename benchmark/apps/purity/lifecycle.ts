// Lifecycle benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state } from '@purity/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Card {
  id: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

let nextId = 1;

function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Card ${nextId - 1}` };
  return d;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const cards = state<Card[]>([]);

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Lifecycle)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="create-1k" @click=${() => cards(buildCards(1000))}>Create 1k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="create-10k" @click=${() => cards(buildCards(10000))}>Create 10k</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="destroy-all" @click=${() => cards([])}>Destroy All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="replace" @click=${() => cards(buildCards(1000))}>Replace 1k</button>
        </div>
        ${hBtn('create-10', 'Create 10', () => cards(buildCards(10)))}
        ${hBtn('create-100', 'Create 100', () => cards(buildCards(100)))}
        ${hBtn('replace-10', 'Replace 10', () => cards(buildCards(10)))}
        ${hBtn('replace-100', 'Replace 100', () => cards(buildCards(100)))}
        ${hBtn('replace-10k', 'Replace 10k', () => cards(buildCards(10000)))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

const container = document.getElementById('container')!;

const fragment = each(
  () => cards(),
  (card: Card) =>
    html`
      <div class="card">
        <span class="id">${String(card.id)}</span>
        <span class="label">${card.label}</span>
      </div>
    ` as unknown as HTMLElement,
  (card: Card) => card.id,
);
container.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
