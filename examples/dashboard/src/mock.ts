// Client-side mock for the dashboard demo. No backend, no CORS, no flakes —
// just a generator that returns plausible "live" data when called.

export interface Stats {
  activeUsers: number;
  reqPerMin: number;
  p95Latency: number;
  errorRate: number;
  ts: number;
}

export interface Event {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Snapshot {
  stats: Stats;
  recent: Event[];
}

// Persistent generator state — accumulates across "fetches" so the dashboard
// shows trends instead of independent random numbers.
const state = {
  users: 1240,
  rpm: 8400,
  latency: 180,
  errors: 0.6,
  events: [] as Event[],
  nextEventId: 0,
};

const SAMPLE_MESSAGES = {
  info: [
    'user signed in',
    'cache warmed',
    'job queued',
    'deploy succeeded',
    'config reloaded',
    'webhook delivered',
    'session resumed',
  ],
  warn: [
    'rate limit approaching',
    'slow query 1.2s',
    'cache miss spike',
    'retry attempt 2',
    'connection pool 80% full',
  ],
  error: [
    'upstream 503',
    'database timeout',
    'auth token expired',
    'queue dropped message',
    'health check failed',
  ],
};

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

function jitter(value: number, scale: number, min = 0): number {
  const next = value + (Math.random() - 0.5) * scale;
  return Math.max(min, next);
}

function newEvent(): Event {
  const r = Math.random();
  const level: Event['level'] = r < 0.05 ? 'error' : r < 0.2 ? 'warn' : 'info';
  return {
    id: `evt-${state.nextEventId++}`,
    ts: Date.now(),
    level,
    message: pick(SAMPLE_MESSAGES[level]),
  };
}

/**
 * Fake "fetch /api/snapshot" — returns a Promise that resolves after a small
 * delay. If `failureRate > 0` it may reject to exercise retry behavior.
 *
 * The AbortSignal is honored: aborting the returned promise rejects with
 * AbortError, just like real `fetch()`.
 */
export function fetchSnapshot(opts: {
  signal: AbortSignal;
  failureRate?: number;
}): Promise<Snapshot> {
  const { signal, failureRate = 0 } = opts;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }

    const delay = 200 + Math.random() * 250;
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      if (Math.random() < failureRate) {
        reject(new Error('upstream timeout (simulated)'));
        return;
      }
      // Advance the simulated counters.
      state.users = Math.round(jitter(state.users, 60, 800));
      state.rpm = Math.round(jitter(state.rpm, 400, 1000));
      state.latency = Math.max(40, jitter(state.latency, 30, 40));
      state.errors = Math.max(0, jitter(state.errors, 0.4, 0));

      // Emit 0–3 new events per tick.
      const burst = Math.floor(Math.random() * 4);
      for (let i = 0; i < burst; i++) state.events.push(newEvent());
      // Keep the last 200 events around so search/filter feels populated.
      if (state.events.length > 200) state.events = state.events.slice(-200);

      resolve({
        stats: {
          activeUsers: state.users,
          reqPerMin: state.rpm,
          p95Latency: Math.round(state.latency),
          errorRate: +state.errors.toFixed(2),
          ts: Date.now(),
        },
        recent: state.events.slice().reverse(),
      });
    }, delay);

    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fake "POST /api/events" — used by the lazyResource for the "send test event"
 * action. Adds an event to the shared store.
 */
export function postEvent(
  args: { level: Event['level']; message: string },
  opts: { signal: AbortSignal },
): Promise<Event> {
  const { signal } = opts;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      const evt: Event = {
        id: `evt-${state.nextEventId++}`,
        ts: Date.now(),
        level: args.level,
        message: args.message,
      };
      state.events.push(evt);
      resolve(evt);
    }, 250);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
