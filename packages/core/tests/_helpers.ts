// Shared async helpers for resource() tests and benchmarks.

export const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

/** Drain several microtask rounds — enough for chained .then handlers + flush. */
export const flushAll = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};

// ---------------------------------------------------------------------------
// matchMedia mock — used by media + environment-preference signal tests.
// ---------------------------------------------------------------------------

export type MockMQL = {
  media: string;
  matches: boolean;
  listeners: ((e: MediaQueryListEvent) => void)[];
  addEventListener(t: 'change', cb: (e: MediaQueryListEvent) => void): void;
  removeEventListener(t: 'change', cb: (e: MediaQueryListEvent) => void): void;
  setMatches(m: boolean): void;
};

export const mockMqls: Map<string, MockMQL> = new Map();
let originalMatchMedia: typeof window.matchMedia | undefined;

export function installMatchMediaMock(): void {
  originalMatchMedia = window.matchMedia;
  (window as unknown as { matchMedia: (q: string) => MockMQL }).matchMedia = (q: string) => {
    let m = mockMqls.get(q);
    if (m) return m;
    m = {
      media: q,
      matches: false,
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener(_t, cb) {
        this.listeners = this.listeners.filter((x) => x !== cb);
      },
      setMatches(v) {
        this.matches = v;
        for (const l of this.listeners) l({ matches: v, media: this.media } as MediaQueryListEvent);
      },
    };
    mockMqls.set(q, m);
    return m;
  };
}

export function uninstallMatchMediaMock(): void {
  if (originalMatchMedia === undefined) {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  } else {
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  }
  mockMqls.clear();
}
