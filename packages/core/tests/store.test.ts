import { describe, expect, it, vi } from 'vite-plus/test';
import { compute, watch } from '@purityjs/signals';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { each } from '../src/control.ts';
import { store } from '../src/store.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('store()', () => {
  it('reads nested values through a stable read-only view', () => {
    const [s] = store({ user: { name: 'Ada', tags: ['a'] } });
    expect(s.user.name).toBe('Ada');
    expect(s.user.tags[0]).toBe('a');
    expect(s.user).toBe(s.user);
    expect(Array.isArray(s.user.tags)).toBe(true);
  });

  it('updating one nested property does not rerun unrelated derivations', () => {
    const [s, update] = store({ form: { name: 'Ada', email: 'a@x' }, rows: [{ n: 1 }, { n: 2 }] });
    const nameRuns = vi.fn(() => s.form.name);
    const emailRuns = vi.fn(() => s.form.email);
    const row1Runs = vi.fn(() => s.rows[1].n);
    const name = compute(nameRuns);
    const email = compute(emailRuns);
    const row1 = compute(row1Runs);
    name();
    email();
    row1();

    update((d) => {
      d.form.name = 'Grace';
    });
    expect(name()).toBe('Grace');
    expect(email()).toBe('a@x');
    expect(row1()).toBe(2);
    expect(nameRuns).toHaveBeenCalledTimes(2);
    expect(emailRuns).toHaveBeenCalledTimes(1);
    expect(row1Runs).toHaveBeenCalledTimes(1);

    update((d) => {
      d.rows[0].n = 10;
    });
    expect(row1()).toBe(2);
    expect(row1Runs).toHaveBeenCalledTimes(1);
    expect(s.rows[0].n).toBe(10);
  });

  it('writing an equal value notifies nobody', () => {
    const [s, update] = store({ a: 1, nan: Number.NaN });
    const runs = vi.fn(() => [s.a, s.nan]);
    const c = compute(runs);
    c();
    update((d) => {
      d.a = 1;
      d.nan = Number.NaN;
    });
    c();
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('tracks added and deleted keys through keys, in and for-in', () => {
    const [s, update] = store<Record<string, number>>({ a: 1 });
    const keys = compute(() => Object.keys(s).join(','));
    const hasB = compute(() => 'b' in s);
    const forIn = compute(() => {
      const out: string[] = [];
      for (const k in s) out.push(k);
      return out.join(',');
    });
    expect([keys(), hasB(), forIn()]).toEqual(['a', false, 'a']);

    update((d) => {
      d.b = 2;
    });
    expect([keys(), hasB(), forIn()]).toEqual(['a,b', true, 'a,b']);

    update((d) => {
      delete d.a;
    });
    expect([keys(), hasB(), forIn()]).toEqual(['b', true, 'b']);
    expect(s.a).toBeUndefined();
  });

  it('a read of a missing key reruns when the key is added', () => {
    const [s, update] = store<{ a?: number }>({});
    const a = compute(() => s.a ?? 'none');
    expect(a()).toBe('none');
    update((d) => {
      d.a = 3;
    });
    expect(a()).toBe(3);
  });

  it('arrays: push, splice, reorder and shrink update length and indices', () => {
    const [s, update] = store({ list: [1, 2, 3] });
    const len = compute(() => s.list.length);
    const joined = compute(() => s.list.map((n) => n * 10).join(','));
    expect([len(), joined()]).toEqual([3, '10,20,30']);

    update((d) => {
      d.list.push(4);
    });
    expect([len(), joined()]).toEqual([4, '10,20,30,40']);

    update((d) => {
      d.list.splice(0, 2);
    });
    expect([len(), joined()]).toEqual([2, '30,40']);

    update((d) => {
      d.list.reverse();
    });
    expect([len(), joined()]).toEqual([2, '40,30']);

    update((d) => {
      d.list.length = 0;
    });
    expect([len(), joined()]).toEqual([0, '']);
  });

  it('batches every write of one update into one effect run', async () => {
    const [s, update] = store({ a: 1, b: 2 });
    const seen: number[] = [];
    const stop = watch(() => {
      seen.push(s.a + s.b);
    });
    await tick();
    update((d) => {
      d.a = 10;
      d.b = 20;
    });
    await tick();
    expect(seen).toEqual([3, 30]);
    stop();
  });

  it('rejects writes through the read view', () => {
    const [s] = store({ a: 1, nested: { b: 2 } });
    expect(() => {
      (s as { a: number }).a = 2;
    }).toThrow(/read-only/);
    expect(() => {
      delete (s.nested as { b?: number }).b;
    }).toThrow(/read-only/);
    expect(s.a).toBe(1);
    expect(s.nested.b).toBe(2);
  });

  it('assigning store objects stores the plain value, not a proxy', () => {
    const [s, update] = store({ a: { v: 1 }, b: null as null | { v: number } });
    update((d) => {
      d.b = d.a;
    });
    expect(s.b).toBe(s.a);
    update((d) => {
      d.b = s.a;
    });
    expect(s.b).toBe(s.a);
    update((d) => {
      d.a.v = 5;
    });
    expect(s.b?.v).toBe(5);
  });

  it('leaves non-plain objects unwrapped', () => {
    const date = new Date(0);
    const map = new Map([[1, 2]]);
    const [s] = store({ date, map });
    expect(s.date).toBe(date);
    expect(s.map).toBe(map);
  });

  it('an update that throws keeps earlier writes, notifies and rethrows', () => {
    const [s, update] = store({ a: 1, b: 1 });
    const a = compute(() => s.a);
    a();
    expect(() =>
      update((d) => {
        d.a = 2;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(a()).toBe(2);
    expect(s.b).toBe(1);
  });

  it('draft reads inside update are not tracked by an enclosing derivation', () => {
    const [s, update] = store({ a: 1 });
    const [other] = store({ x: 1 });
    const runs = vi.fn(() => {
      const value = other.x;
      update((d) => {
        void d.a;
      });
      return value;
    });
    const c = compute(runs);
    c();
    update((d) => {
      d.a = 2;
    });
    c();
    expect(runs).toHaveBeenCalledTimes(1);
    expect(s.a).toBe(2);
  });

  it('finds view items inside a draft (remove-this-row handlers)', () => {
    const [s, update] = store({ list: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const item = s.list[1];
    const len = compute(() => s.list.length);
    expect(len()).toBe(3);
    update((d) => {
      expect(d.list.indexOf(item)).toBe(1);
      expect(d.list.includes(item)).toBe(true);
      expect(d.list.lastIndexOf(item)).toBe(1);
      d.list.splice(d.list.indexOf(item), 1);
    });
    expect(len()).toBe(2);
    expect(s.list.includes(s.list[1])).toBe(true);
    expect(s.list.map((r) => r.id)).toEqual([1, 3]);
  });

  it('getters read and setters write through the tracked proxies', () => {
    const [s, update] = store({
      a: 1,
      _b: 1,
      get double() {
        return this.a * 2;
      },
      set b(value: number) {
        this._b = value;
      },
    });
    const double = compute(() => s.double);
    const b = compute(() => s._b);
    expect([double(), b()]).toEqual([2, 1]);
    update((d) => {
      d.a = 5;
      d.b = 7;
    });
    expect([double(), b()]).toEqual([10, 7]);
  });

  it('drafts cannot reach or replace the prototype', () => {
    const [s, update] = store<Record<string, unknown>>({ a: 1 });
    expect(() =>
      update((d) => {
        d['__proto__'] = { evil: 1 };
      }),
    ).toThrow(/__proto__/);
    update((d) => {
      const proto = d['__proto__'] as Record<string, unknown>;
      expect(proto).toBe(Object.prototype);
    });
    expect(s.evil).toBeUndefined();
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('Object.defineProperty on a draft notifies key readers', () => {
    const [s, update] = store<Record<string, number>>({});
    const keys = compute(() => Object.keys(s).length);
    expect(keys()).toBe(0);
    update((d) => {
      Object.defineProperty(d, 'x', {
        value: 1,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
    expect(keys()).toBe(1);
    expect(s.x).toBe(1);
  });

  it('tracks symbol keys and returns frozen nested data as is', () => {
    const sym = Symbol('k');
    const frozen = Object.freeze({ inner: { v: 1 } });
    const [s, update] = store<{ [sym]?: number; f: typeof frozen }>({ f: frozen });
    const symRead = compute(() => s[sym] ?? 0);
    expect(symRead()).toBe(0);
    update((d) => {
      d[sym] = 4;
    });
    expect(symRead()).toBe(4);
    expect(s.f.inner).toBe(frozen.inner);
    expect(s.f.inner.v).toBe(1);
  });

  it('array pop, shift, unshift, sort and sparse writes update readers', () => {
    const [s, update] = store({ list: [3, 1, 2] });
    const joined = compute(() => `${s.list.length}:${s.list.join(',')}`);
    update((d) => {
      d.list.sort();
    });
    expect(joined()).toBe('3:1,2,3');
    update((d) => {
      d.list.pop();
      d.list.shift();
      d.list.unshift(9);
    });
    expect(joined()).toBe('2:9,2');
    update((d) => {
      d.list[4] = 5;
    });
    expect(joined()).toBe('5:9,2,,,5');
  });

  it('store values nested inside new objects and arrays stay writable and tracked', () => {
    const [s, update] = store({
      list: [{ n: 'a' }, { n: 'b' }],
      b: null as null | { inner: { n: string } },
    });
    update((d) => {
      d.list = [...s.list, { n: 'c' }];
    });
    const first = vi.fn(() => s.list[0].n);
    const c = compute(first);
    expect(c()).toBe('a');
    update((d) => {
      d.list[0].n = 'q';
    });
    expect(c()).toBe('q');
    update((d) => {
      d.list = s.list.filter((item) => item.n !== 'b');
    });
    update((d) => {
      d.list[1].n = 'z';
    });
    expect(s.list.map((item) => item.n)).toEqual(['q', 'z']);
    update((d) => {
      d.b = { inner: s.list[0] };
    });
    expect(s.b!.inner).toBe(s.list[0]);
    update((d) => {
      d.b!.inner.n = 'r';
    });
    expect(c()).toBe('r');
  });

  it('finds view items in arrays rebuilt with spread or filter', () => {
    const [s, update] = store({ list: [{ n: 'a' }, { n: 'b' }] });
    const first = s.list[0];
    update((d) => {
      d.list = [...s.list, { n: 'c' }];
    });
    expect(s.list.indexOf(s.list[1])).toBe(1);
    expect(s.list.includes(first)).toBe(true);
    update((d) => {
      d.list = s.list.filter((item) => item.n !== 'a');
      expect(d.list.indexOf(first)).toBe(-1);
      expect(d.list.lastIndexOf(s.list[0])).toBe(0);
    });
  });

  it('reads a non-writable, non-configurable property of an unfrozen object without throwing', () => {
    const data: { a: { b: number }; c: number } = { a: { b: 1 }, c: 1 };
    Object.defineProperty(data, 'a', { value: { b: 1 }, writable: false, configurable: false });
    const [s, update] = store(data);
    expect(s.a.b).toBe(1);
    const c = compute(() => s.c);
    c();
    update((d) => {
      d.c = 2;
    });
    expect(c()).toBe(2);
  });

  it('rejects a non-object initial value', () => {
    expect(() => store(1 as unknown as object)).toThrow(TypeError);
  });
});

describe('store() in templates', () => {
  it('a text binding and each() rows update from single-property writes', async () => {
    const [s, update] = store({ title: 'T', rows: [{ id: 1, label: 'a' }] });
    const host = document.createElement('div');
    mount(
      () =>
        html`<div><h1>${() => s.title}</h1><ul>${each(
          () => s.rows,
          (row) => html`<li>${() => row().label}</li>`,
          (row) => row.id,
        )}</ul></div>`,
      host,
    );
    const firstLi = host.querySelector('li');
    update((d) => {
      d.title = 'U';
      d.rows.push({ id: 2, label: 'b' });
    });
    await tick();
    expect(host.querySelector('h1')!.textContent).toBe('U');
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    expect(host.querySelector('li')).toBe(firstLi);
  });
});
