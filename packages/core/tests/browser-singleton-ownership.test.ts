// @vitest-environment jsdom
// SV2-002 / SV2-015: shared browser signals outlive their individual consumers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { fullscreenSignal, _resetFullscreenSignal } from '../src/fullscreen-signal.ts';
import { localeSignal, _resetLocaleSignal } from '../src/locale-signal.ts';
import { onlineSignal, _resetOnlineSignal } from '../src/online-signal.ts';
import { pageVisibilitySignal, _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { watch, type ComputedAccessor } from '../src/signals.ts';

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));
const disposers: Array<() => void> = [];
const restores: Array<() => void> = [];
type Kind = 'locale' | 'fullscreen' | 'online' | 'visibility';

interface Scenario {
  read: () => ComputedAccessor<unknown>;
  reset: () => void;
  target: EventTarget;
  event: string;
  initial: unknown;
  updated: unknown;
  change: (value: unknown) => void;
}

function scenario(kind: Kind): Scenario {
  let owner: object;
  let property: string;
  let read: Scenario['read'];
  let reset: Scenario['reset'];
  let target: EventTarget;
  let event: string;
  let initial: unknown;
  let updated: unknown;
  switch (kind) {
    case 'locale':
      owner = navigator;
      property = 'language';
      read = localeSignal;
      reset = _resetLocaleSignal;
      target = window;
      event = 'languagechange';
      initial = 'en-AU';
      updated = 'en-NZ';
      break;
    case 'fullscreen':
      owner = document;
      property = 'fullscreenElement';
      read = fullscreenSignal;
      reset = _resetFullscreenSignal;
      target = document;
      event = 'fullscreenchange';
      initial = null;
      updated = document.createElement('section');
      break;
    case 'online':
      owner = navigator;
      property = 'onLine';
      read = onlineSignal;
      reset = _resetOnlineSignal;
      target = window;
      event = 'offline';
      initial = true;
      updated = false;
      break;
    case 'visibility':
      owner = document;
      property = 'visibilityState';
      read = pageVisibilitySignal;
      reset = _resetPageVisibilitySignal;
      target = document;
      event = 'visibilitychange';
      initial = 'visible';
      updated = 'hidden';
      break;
  }
  reset();
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  let current = initial;
  Object.defineProperty(owner, property, { configurable: true, get: () => current });
  restores.push(() => {
    if (descriptor) Object.defineProperty(owner, property, descriptor);
    else Reflect.deleteProperty(owner, property);
  });
  return {
    read,
    reset,
    target,
    event,
    initial,
    updated,
    change(value) {
      current = value;
      target.dispatchEvent(new Event(kind === 'online' && value === true ? 'online' : event));
    },
  };
}

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  _resetFullscreenSignal();
  _resetLocaleSignal();
  _resetOnlineSignal();
  _resetPageVisibilitySignal();
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

describe.each(['locale', 'fullscreen', 'online', 'visibility'] as const)(
  '%s shared browser singleton',
  (kind) => {
    let source: Scenario;
    beforeEach(() => {
      source = scenario(kind);
    });

    it('keeps the second consumer live after the creating owner unmounts', async () => {
      let signal!: ComputedAccessor<unknown>;
      const first = mount(() => {
        signal = source.read();
        expect(signal()).toBe(source.initial);
        return document.createTextNode('first');
      }, document.createElement('div'));
      disposers.push(first.unmount);

      const seen: unknown[] = [];
      const second = mount(() => {
        expect(source.read()).toBe(signal);
        watch(() => {
          seen.push(signal());
        });
        return document.createTextNode('second');
      }, document.createElement('div'));
      disposers.push(second.unmount);

      first.unmount();
      source.change(source.updated);
      await tick();
      expect(signal()).toBe(source.updated);
      expect(source.read()).toBe(signal);
      expect(seen).toEqual([source.initial, source.updated]);

      second.unmount();
      // Consumer disposal stops its watch, not the shared source.
      source.change(source.initial);
      await tick();
      expect(seen).toEqual([source.initial, source.updated]);
    });

    it('preserves computed equality filtering for a same-tick round trip', async () => {
      const signal = source.read();
      const seen: unknown[] = [];
      disposers.push(
        watch(() => {
          seen.push(signal());
        }),
      );
      source.change(source.updated);
      source.change(source.initial);
      await tick();
      expect(signal()).toBe(source.initial);
      expect(seen).toEqual([source.initial]);
    });

    it('keeps calls and get read-only, and peek does not subscribe', async () => {
      const signal = source.read();
      expect(Reflect.apply(signal, undefined, ['ignored', 1])).toBe(source.initial);
      expect(Reflect.apply(signal.get, undefined, ['ignored', 1])).toBe(source.initial);
      expect('set' in signal).toBe(false);
      const seen: unknown[] = [];
      disposers.push(
        watch(() => {
          seen.push(signal.peek());
        }),
      );
      source.change(source.updated);
      await tick();
      expect(signal.get()).toBe(source.updated);
      expect(seen).toEqual([source.initial]);
    });

    it('registers once and resets once without updating the retired accessor', () => {
      const add = vi.spyOn(source.target, 'addEventListener');
      const remove = vi.spyOn(source.target, 'removeEventListener');
      const retired = source.read();
      expect(retired()).toBe(source.initial);
      expect(source.read()).toBe(retired);
      expect(add.mock.calls.filter(([name]) => name === source.event)).toHaveLength(1);
      source.reset();
      source.reset();
      expect(remove.mock.calls.filter(([name]) => name === source.event)).toHaveLength(1);
      const current = source.read();
      expect(current).not.toBe(retired);
      expect(add.mock.calls.filter(([name]) => name === source.event)).toHaveLength(2);
      source.change(source.updated);
      expect(current()).toBe(source.updated);
      expect(retired()).toBe(source.initial);
    });
  },
);

it('keeps separate browser-signal caches independent when one is reset', async () => {
  const locale = scenario('locale');
  const online = scenario('online');
  const language = locale.read();
  const connectivity = online.read();
  locale.reset();
  online.change(online.updated);
  await tick();
  expect(connectivity()).toBe(online.updated);
  expect(online.read()).toBe(connectivity);
  expect(locale.read()).not.toBe(language);
});
