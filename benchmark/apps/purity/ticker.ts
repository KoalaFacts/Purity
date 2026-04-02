import { each, html, state } from '@purity/core';

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

export function createTickerApp(
  tbody: HTMLElement,
  frameCountEl: HTMLElement,
  startBtn: HTMLElement,
  stopBtn: HTMLElement,
  run500Btn: HTMLElement,
) {
  const stocks = state<Stock[]>(makeStocks());
  let rafId = 0;
  let frames = 0;

  const fragment = each(
    () => stocks(),
    (stock: Stock) => {
      const tr = html`
        <tr class="${stock.change >= 0 ? 'positive' : 'negative'}">
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

  function tick() {
    stocks(updateRandom(stocks()));
    frames++;
    frameCountEl.textContent = `Frames: ${frames}`;
    rafId = requestAnimationFrame(tick);
  }

  startBtn.addEventListener('click', () => {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  });

  stopBtn.addEventListener('click', () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
  });

  run500Btn.addEventListener('click', () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
    frames = 0;
    const t0 = performance.now();
    let count = 0;

    function step() {
      stocks(updateRandom(stocks()));
      count++;
      if (count < 500) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = 0;
        const elapsed = performance.now() - t0;
        frameCountEl.textContent = `Frames: 500 | ${elapsed.toFixed(1)}ms`;
      }
    }
    rafId = requestAnimationFrame(step);
  });
}
