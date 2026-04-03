// Stock ticker benchmark — idiomatic Solid version.
// Uses: createSignal, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

interface Stock {
  id: number;
  symbol: string;
  price: number;
  change: number;
  volume: number;
}

const SYMBOLS = [
  'AAPL', 'GOOG', 'MSFT', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'JNJ',
  'WMT', 'PG', 'MA', 'UNH', 'HD', 'DIS', 'BAC', 'XOM', 'PFE', 'KO',
  'PEP', 'CSCO', 'INTC', 'NFLX', 'CMCSA', 'ADBE', 'CRM', 'ABT', 'NKE', 'MRK',
  'T', 'VZ', 'CVX', 'WFC', 'LLY', 'TMO', 'AVGO', 'COST', 'DHR', 'ACN',
  'TXN', 'MDT', 'UPS', 'NEE', 'HON', 'PM', 'QCOM', 'LOW', 'UNP', 'ORCL',
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
// Module-level signals and animation state
// ---------------------------------------------------------------------------

const [stocks, setStocks] = createSignal<Stock[]>(makeStocks());
const [frameLabel, setFrameLabel] = createSignal('Frames: 0');
let rafId = 0;
let frames = 0;

function tick() {
  setStocks(updateRandom(stocks()));
  frames++;
  setFrameLabel(`Frames: ${frames}`);
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

function run500() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  frames = 0;
  const t0 = performance.now();
  let count = 0;

  function step() {
    setStocks(updateRandom(stocks()));
    count++;
    if (count < 500) {
      rafId = requestAnimationFrame(step);
    } else {
      rafId = 0;
      const elapsed = performance.now() - t0;
      setFrameLabel(`Frames: 500 | ${elapsed.toFixed(1)}ms`);
    }
  }
  rafId = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Solid (Ticker)</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="start" onClick={startTicker}>Start Ticker</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="stop" onClick={stopTicker}>Stop Ticker</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run-500" onClick={run500}>Run 500 Frames</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="frame-count">{frameLabel()}</div>
      <table class="table table-hover table-striped test-data">
        <thead><tr><th>Symbol</th><th>Price</th><th>Change</th><th>Volume</th></tr></thead>
        <tbody id="tbody">
          <For each={stocks()}>
            {(stock: Stock) => (
              <tr class={stock.change >= 0 ? 'positive' : 'negative'}>
                <td>{stock.symbol}</td>
                <td>{stock.price.toFixed(2)}</td>
                <td>{stock.change.toFixed(2)}%</td>
                <td>{stock.volume}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </>
  );
}

render(App, document.getElementById('app')!);
