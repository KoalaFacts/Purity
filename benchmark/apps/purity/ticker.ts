// Stock ticker benchmark — Purity idiomatic version.
// Uses: state, each, html, mount. Zero vanilla JS for UI wiring.

import { each, html, mount, state } from '@purityjs/core';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface Stock {
  id: number;
  symbol: string;
  price: number;
  change: number;
  volume: number;
}

const SYMBOLS = [
  'AAPL',
  'GOOG',
  'MSFT',
  'AMZN',
  'META',
  'TSLA',
  'NVDA',
  'JPM',
  'V',
  'JNJ',
  'WMT',
  'PG',
  'MA',
  'UNH',
  'HD',
  'DIS',
  'BAC',
  'XOM',
  'PFE',
  'KO',
  'PEP',
  'CSCO',
  'INTC',
  'NFLX',
  'CMCSA',
  'ADBE',
  'CRM',
  'ABT',
  'NKE',
  'MRK',
  'T',
  'VZ',
  'CVX',
  'WFC',
  'LLY',
  'TMO',
  'AVGO',
  'COST',
  'DHR',
  'ACN',
  'TXN',
  'MDT',
  'UPS',
  'NEE',
  'HON',
  'PM',
  'QCOM',
  'LOW',
  'UNP',
  'ORCL',
];

function makeStocks(): Stock[] {
  return SYMBOLS.map((symbol, i) => ({
    id: i,
    symbol,
    price: 50 + Math.random() * 450,
    change: 0,
    volume: (Math.random() * 10_000_000) | 0,
  }));
}

function updateRandom(stocks: Stock[]): Stock[] {
  const next = stocks.slice();
  for (let i = 0; i < 10; i++) {
    const idx = (Math.random() * next.length) | 0;
    const s = { ...next[idx] };
    const delta = (Math.random() - 0.5) * 0.06;
    s.price = Math.max(1, s.price * (1 + delta));
    s.change = delta * 100;
    s.volume = s.volume + ((Math.random() * 1000) | 0);
    next[idx] = s;
  }
  return next;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const stocks = state<Stock[]>(makeStocks());
const frameMsg = state('Frames: 0');

let rafId = 0;

// ---------------------------------------------------------------------------
// Ticker loop
// ---------------------------------------------------------------------------

function tick() {
  stocks(updateRandom(stocks()));
  rafId = requestAnimationFrame(tick);
}

function startTicker() {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function stopTicker() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function runFrames(total: number) {
  cancelAnimationFrame(rafId);
  rafId = 0;
  let count = 0;
  const t0 = performance.now();

  function step() {
    stocks(updateRandom(stocks()));
    count++;
    if (count < total) {
      rafId = requestAnimationFrame(step);
    } else {
      rafId = 0;
      const elapsed = performance.now() - t0;
      frameMsg(`Frames: ${total} | ${elapsed.toFixed(1)}ms`);
    }
  }
  rafId = requestAnimationFrame(step);
}

function runFrameBatch(total: number) {
  cancelAnimationFrame(rafId);
  rafId = 0;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) stocks(updateRandom(stocks()));
  const elapsed = performance.now() - t0;
  frameMsg(`Frames: ${total} | ${elapsed.toFixed(1)}ms`);
}

function run500() {
  runFrames(500);
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
      <div class="col-md-6"><h1>Purity (Ticker)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="start" @click=${startTicker}>Start Ticker</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="stop" @click=${stopTicker}>Stop Ticker</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="run-500" @click=${run500}>Run 500 Frames</button>
        </div>
        ${hBtn('run-10', 'Run 10', () => runFrameBatch(10))}
        ${hBtn('run-100', 'Run 100', () => runFrameBatch(100))}
        ${hBtn('run-500-hidden', 'Run 500', () => runFrameBatch(500))}
        ${hBtn('run-1000', 'Run 1000', () => runFrameBatch(1000))}
        ${hBtn('run-10000', 'Run 10000', () => runFrameBatch(10000))}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Frame counter display
// ---------------------------------------------------------------------------

function FrameCount() {
  return html`<div id="frame-count">${() => frameMsg()}</div>`;
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

const tbody = document.getElementById('tbody')!;

const fragment = each(
  () => stocks(),
  (stock: Stock) => {
    const tr = html`
      <tr :class=${stock.change >= 0 ? 'positive' : 'negative'}>
        <td>${stock.symbol}</td>
        <td>${stock.price.toFixed(2)}</td>
        <td>${stock.change.toFixed(2)}%</td>
        <td>${String(stock.volume)}</td>
      </tr>
    ` as unknown as HTMLTableRowElement;
    return tr;
  },
  (stock: Stock) => stock.id,
);
tbody.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
mount(FrameCount, document.getElementById('frame-count-container')!);
