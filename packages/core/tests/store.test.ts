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
