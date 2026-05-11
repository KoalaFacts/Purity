// ---------------------------------------------------------------------------
// Purity Live Dashboard — a ~240-line demo exercising the framework end to end.
//
// Primitives demonstrated (annotated inline):
//   state         — paused, simulateFailure, dark, search term, latency history
//   compute       — filtered events, status pill text
//   debounced     — search input feeding the events filter
//   resource      — polling stats with retry + pollInterval + falsy-source pause
//   lazyResource  — "send test event" mutation triggered by a button
//   each          — events list rendering with keyed reconciliation
//   when / match  — conditional UI for empty / error / status pill
//   mount         — mount the dashboard into #app (light DOM — no Shadow DOM)
//   watch         — three uses inside App: dark-mode reflection, latency
//                   history capture, and snapshot refresh after a manual send
//   onDispose     — restore the document theme when the app unmounts
//
// No framework code is hidden in helpers — read top-to-bottom.
// ---------------------------------------------------------------------------

import {
  compute,
  debounced,
  each,
  html,
  lazyResource,
  match,
  mount,
  onDispose,
  resource,
  state,
  watch,
  when,
} from '@purityjs/core';
import { fetchSnapshot, postEvent, type Event as LogEvent, type Snapshot } from './mock.ts';

// ---------------------------------------------------------------------------
// Local UI state
// ---------------------------------------------------------------------------

const paused = state(false);
const simulateFailure = state(false);
const dark = state(matchMedia('(prefers-color-scheme: dark)').matches);
const searchTerm = state('');
const levelFilter = state<'all' | LogEvent['level']>('all');
const latencyHistory = state<number[]>([]);

// `debounced` waits for a 200ms quiet window before propagating the search
// term to consumers. Typing fast doesn't refilter on every keystroke.
const search = debounced(searchTerm, 200);

// ---------------------------------------------------------------------------
// Polling resource — the heart of the demo
// ---------------------------------------------------------------------------

// Source returns `null` when paused, which makes `resource()` skip the fetch
// without tearing the resource down. Toggle the "Pause" button to see polling
// stop and resume cleanly. The source is also a tracking dep, so re-fetches
// happen whenever `paused` flips.
const snapshot = resource<Snapshot, 'tick'>(
  () => (paused() ? null : 'tick'),
  (_, { signal }) => fetchSnapshot({ signal, failureRate: simulateFailure() ? 0.5 : 0 }),
  {
    pollInterval: 2_000, // re-fetch every 2s after each settle
    retry: 3, // exponential backoff on failure (200ms → 400ms → 800ms)
  },
);

// `lazyResource` only fires when `.fetch(args)` is called. Used here to send
// a test event without polling.
const sendEvent = lazyResource(postEvent);

// ---------------------------------------------------------------------------
// Derived UI state
// ---------------------------------------------------------------------------

const filteredEvents = compute<LogEvent[]>(() => {
  const all = snapshot()?.recent ?? [];
  const q = search().trim().toLowerCase();
  const lvl = levelFilter();
  return all.filter(
    (e) => (lvl === 'all' || e.level === lvl) && (!q || e.message.toLowerCase().includes(q)),
  );
});

// Status pill: ok | error | paused
const status = compute<'ok' | 'error' | 'paused'>(() =>
  paused() ? 'paused' : snapshot.error() ? 'error' : 'ok',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? ''));

const isLevel = (v: string): v is LogEvent['level'] =>
  v === 'info' || v === 'warn' || v === 'error';

function sparkline(values: number[]): string {
  if (values.length < 2) return '';
  const w = 240;
  const h = 60;
  const max = Math.max(...values, 1);
  const step = w / Math.max(values.length - 1, 1);
  const path = values
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h * 0.9 - 4).toFixed(1)}`,
    )
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" /></svg>`;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const App = () => {
  // Reflect dark-mode preference on the document root. This watcher
  // auto-disposes when the component unmounts (it captures mount()'s
  // ComponentContext via getCurrentContext()).
  watch(() => {
    document.documentElement.dataset.theme = dark() ? 'dark' : 'light';
  });

  // Track latency history for the sparkline. Skips the initial undefined value;
  // each subsequent snapshot resolution appends a sample.
  watch(snapshot, (next) => {
    if (!next) return;
    latencyHistory((prev) => [...prev.slice(-29), next.stats.p95Latency]);
  });

  // When a manual "send test event" succeeds, refresh the snapshot so the
  // new event appears in the events list immediately instead of waiting for
  // the next 2s poll tick.
  watch(sendEvent, (next) => {
    if (next) snapshot.refresh();
  });

  // Demonstrate onDispose: when the app unmounts, drop the theme attribute
  // we set on the host document. Real apps would clear timers, listeners, etc.
  onDispose(() => {
    delete document.documentElement.dataset.theme;
  });

  return html`
    <header class="top">
      <h1>Purity Live Dashboard</h1>
      ${() =>
        match(status, {
          ok: () => html`<span class="pill ok"><span class="dot"></span> live</span>`,
          error: () => html`<span class="pill err"><span class="dot"></span> error</span>`,
          paused: () => html`<span class="pill"><span class="dot"></span> paused</span>`,
        })}
      <div class="grow"></div>
      <label> <input type="checkbox" ::checked=${dark} /> dark </label>
      <a href="https://github.com/KoalaFacts/Purity" target="_blank" rel="noreferrer"> source </a>
    </header>

    <main>
      <section class="card">
        <div class="controls">
          <button @click=${() => paused((v) => !v)}>
            ${() => (paused() ? 'Resume' : 'Pause')}
          </button>
          <button
            @click=${() => snapshot.refresh()}
            ?disabled=${() => snapshot.loading() || paused()}
          >
            Refresh now
          </button>
          <button
            @click=${() =>
              sendEvent.fetch({
                level: 'info',
                message: `manual event ${new Date().toLocaleTimeString()}`,
              })}
            ?disabled=${() => sendEvent.loading()}
          >
            Send test event
          </button>
          <label> <input type="checkbox" ::checked=${simulateFailure} /> simulate failures </label>
        </div>
      </section>

      <section class="stats">
        <div class="card stat">
          <div class="label">Active users</div>
          <div class="value">${() => fmt(snapshot()?.stats.activeUsers ?? 0)}</div>
          <div class="delta">
            ${() =>
              snapshot.loading()
                ? 'updating…'
                : `as of ${time(snapshot()?.stats.ts ?? Date.now())}`}
          </div>
        </div>
        <div class="card stat">
          <div class="label">Requests / min</div>
          <div class="value">${() => fmt(snapshot()?.stats.reqPerMin ?? 0)}</div>
        </div>
        <div class="card stat">
          <div class="label">P95 latency</div>
          <div class="value">${() => `${snapshot()?.stats.p95Latency ?? 0}ms`}</div>
          <div .innerHTML=${() => sparkline(latencyHistory())}></div>
        </div>
        <div class="card stat">
          <div class="label">Error rate</div>
          <div class="value">${() => `${snapshot()?.stats.errorRate ?? 0}%`}</div>
          <div class="delta">
            ${() =>
              when(
                () => !!snapshot.error(),
                () => `last fetch failed: ${errorText(snapshot.error())}`,
                () => '—',
              )}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="controls">
          <input class="grow" type="text" placeholder="search events…" ::value=${searchTerm} />
          <select
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === 'all' || isLevel(v)) levelFilter(v);
            }}
          >
            <option value="all">all levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
        <ul class="events" role="log" aria-live="polite" aria-label="recent events">
          ${() =>
            when(
              () => filteredEvents().length === 0,
              () =>
                html`<li class="empty">
                  ${() =>
                    snapshot.loading() ? 'loading events…' : 'no events match the current filter'}
                </li>`,
            )}
          ${each(
            filteredEvents,
            (evt) => html`
              <li>
                <span class="time">${() => time(evt().ts)}</span>
                <span class="level ${() => evt().level}">${() => evt().level}</span>
                <span class="msg">${() => evt().message}</span>
              </li>
            `,
            (evt) => evt.id,
          )}
        </ul>
      </section>

      <p class="footer">
        Built with <a href="https://github.com/KoalaFacts/Purity">Purity</a> — view
        <a href="https://github.com/KoalaFacts/Purity/tree/main/examples/dashboard">demo source</a>.
      </p>
    </main>
  `;
};

mount(App, document.getElementById('app')!);
