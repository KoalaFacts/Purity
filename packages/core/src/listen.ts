// ---------------------------------------------------------------------------
// Shared listener plumbing for the browser-API signal modules (ADR 0039/0041).
//
// - bindListeners(): attaches every [target, type, handler] in order. If one
//   attach throws, the listeners already bound are removed, the failure is
//   logged, and null is returned so the caller can fall back. Otherwise the
//   returned function detaches all of them (best-effort).
// - isolate(): wraps a handler so a throw is logged instead of escaping the
//   DOM event-dispatch path.
// ---------------------------------------------------------------------------

export type ListenerSpec = readonly [target: EventTarget, type: string, handler: EventListener];

export function bindListeners(specs: readonly ListenerSpec[], label: string): (() => void) | null {
  for (let i = 0; i < specs.length; i++) {
    const [target, type, handler] = specs[i];
    try {
      target.addEventListener(type, handler);
    } catch (err) {
      unbindListeners(specs, i);
      console.error(`[purity] ${label}: failed to register listeners`, err);
      return null;
    }
  }
  return () => unbindListeners(specs, specs.length);
}

function unbindListeners(specs: readonly ListenerSpec[], count: number): void {
  for (let i = 0; i < count; i++) {
    const [target, type, handler] = specs[i];
    try {
      target.removeEventListener(type, handler);
    } catch {
      // best-effort detach — secondary failures must not throw out of reset.
    }
  }
}

export function isolate(label: string, fn: (e: Event) => void): EventListener {
  return (e) => {
    try {
      fn(e);
    } catch (err) {
      console.error(`[purity] ${label}: handler threw`, err);
    }
  };
}
