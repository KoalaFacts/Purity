// ---------------------------------------------------------------------------
// HostedContext — an ownership scope that forwards host fields to the
// surrounding component (shared by errorBoundary() and loading()).
// ---------------------------------------------------------------------------

import { ComponentContext } from '@purityjs/signals';

// Component fields that belong to the host element, not to an ownership scope.
const HOST_FIELDS = [
  '_internals',
  '_stateRefs',
  '_shadowRoot',
  '_slotContent',
  '_ssrSlots',
  '_ssrStyles',
] as const;

// Host callback lists (the form hooks). An attempt sees its own list whose
// push/splice also add to / remove from the host's list, so every hook it or
// one of its nested scopes registers, at any time, is released with it.
const HOST_LISTS = ['_formAssociated', '_formDisabled', '_formReset', '_formStateRestore'] as const;

type List = unknown[];

export class HostedContext extends ComponentContext {
  declare _host: ComponentContext;
  declare _own?: Record<string, List>;
  constructor(host: ComponentContext) {
    super();
    this._host = host;
  }
}

for (const key of HOST_FIELDS) {
  Object.defineProperty(HostedContext.prototype, key, {
    get(this: HostedContext) {
      return this._host[key];
    },
    // Lazy initialisation (`ctx._stateRefs ??= new Map()`) reaches the host;
    // clears do not: tearing down a failed attempt (unmountContext sets
    // _slotContent = undefined) must not wipe the host's slot content.
    set(this: HostedContext, value: unknown) {
      if (value != null) (this._host as unknown as Record<string, unknown>)[key] = value;
    },
  });
}

for (const key of HOST_LISTS) {
  Object.defineProperty(HostedContext.prototype, key, {
    get(this: HostedContext) {
      const host = this._host as unknown as Record<string, List | null | undefined>;
      const own = (this._own ??= {});
      if (own[key]) return own[key];
      // Teardown removes whatever is still registered from the host's list.
      (this.disposers ??= []).push(() => own[key].splice(0, 1e9));
      return (own[key] = Object.assign([] as List, {
        push(this: List, fn: unknown) {
          (host[key] ??= []).push(fn);
          return ([] as List).push.call(this, fn);
        },
        splice(this: List, start: number, count: number) {
          const removed = ([] as List).splice.call(this, start, count);
          for (const fn of removed) {
            const list = host[key];
            list?.splice(list.indexOf(fn) >>> 0, 1);
          }
          return removed;
        },
      }));
    },
    set() {},
  });
}
