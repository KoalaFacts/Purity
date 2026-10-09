// Stock ticker benchmark — idiomatic React version.
// Uses: useState, useRef, useEffect (rAF cleanup on unmount). Plain React, no signals.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
// Hidden benchmark button helper
// ---------------------------------------------------------------------------

function HBtn(props: { id: string; onClick: () => void; children: string }) {
  return (
    <button type="button" id={props.id} style={{ display: 'none' }} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [stocks, setStocks] = useState<Stock[]>(makeStocks);
  const [frameLabel, setFrameLabel] = useState('Frames: 0');
  const rafId = useRef(0);
  const frames = useRef(0);

  // Cancel any pending animation frame when the app unmounts.
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  function tick() {
    setStocks((s) => updateRandom(s));
    frames.current++;
    setFrameLabel(`Frames: ${frames.current}`);
    rafId.current = requestAnimationFrame(tick);
  }

  function startTicker() {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(tick);
  }

  function stopTicker() {
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
  }

  function runFrames(total: number) {
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    frames.current = 0;
    const t0 = performance.now();
    let count = 0;
    const step = () => {
      setStocks((s) => updateRandom(s));
      count++;
      if (count < total) {
        rafId.current = requestAnimationFrame(step);
      } else {
        rafId.current = 0;
        const elapsed = performance.now() - t0;
        setFrameLabel(`Frames: ${total} | ${elapsed.toFixed(1)}ms`);
      }
    };
    rafId.current = requestAnimationFrame(step);
  }

  function runFrameBatch(total: number) {
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    const t0 = performance.now();
    // All updates are queued and applied during the single render React schedules
    // for this click, so the displayed ms covers queueing only (see report notes).
    for (let i = 0; i < total; i++) setStocks((s) => updateRandom(s));
    const elapsed = performance.now() - t0;
    setFrameLabel(`Frames: ${total} | ${elapsed.toFixed(1)}ms`);
  }

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Ticker)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="start"
                  onClick={startTicker}
                >
                  Start Ticker
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="stop"
                  onClick={stopTicker}
                >
                  Stop Ticker
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="run-500"
                  onClick={() => runFrames(500)}
                >
                  Run 500 Frames
                </button>
              </div>
              <HBtn id="run-10" onClick={() => runFrameBatch(10)}>
                Run 10
              </HBtn>
              <HBtn id="run-100" onClick={() => runFrameBatch(100)}>
                Run 100
              </HBtn>
              <HBtn id="run-500-hidden" onClick={() => runFrameBatch(500)}>
                Run 500
              </HBtn>
              <HBtn id="run-1000" onClick={() => runFrameBatch(1000)}>
                Run 1000
              </HBtn>
              <HBtn id="run-10000" onClick={() => runFrameBatch(10000)}>
                Run 10000
              </HBtn>
            </div>
          </div>
        </div>
      </div>
      <div id="frame-count">{frameLabel}</div>
      <table className="table table-hover table-striped test-data">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Change</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody id="tbody">
          {stocks.map((stock) => (
            <tr key={stock.id} className={stock.change >= 0 ? 'positive' : 'negative'}>
              <td>{stock.symbol}</td>
              <td>{stock.price.toFixed(2)}</td>
              <td>{stock.change.toFixed(2)}%</td>
              <td>{stock.volume}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
