import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { each, match } from '../src/control.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('match', () => {
  it('renders the matching case', async () => {
    const status = state('loading');
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement('p');
        el.className = 'loading';
        el.textContent = 'Loading...';
        return el;
      },
      success: () => {
        const el = document.createElement('p');
        el.className = 'success';
        return el;
      },
      error: () => {
        const el = document.createElement('p');
        el.className = 'error';
        return el;
      },
    });

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.loading')).not.toBeNull();
    expect(container.querySelector('.success')).toBeNull();
  });

  it('switches content when value changes', async () => {
    const status = state('loading');
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement('p');
        el.className = 'loading';
        return el;
      },
      success: () => {
        const el = document.createElement('p');
        el.className = 'success';
        return el;
      },
    });

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.loading')).not.toBeNull();

    status('success');
    await tick();
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.success')).not.toBeNull();
  });

  it('renders fallback for unmatched cases', async () => {
    const status = state('unknown');
    const fragment = match(
      () => status(),
      {
        loading: () => {
          const el = document.createElement('p');
          el.className = 'loading';
          return el;
        },
      },
      () => {
        const el = document.createElement('p');
        el.className = 'fallback';
        el.textContent = 'Unknown state';
        return el;
      },
    );

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.loading')).toBeNull();
    expect(container.querySelector('.fallback')).not.toBeNull();
  });

  it('renders nothing when no match and no fallback', async () => {
    const status = state('unknown');
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement('p');
        el.className = 'loading';
        return el;
      },
    });

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.loading')).toBeNull();
  });

  it('works with number values', async () => {
    const code = state(200);
    const fragment = match(() => code(), {
      200: () => {
        const el = document.createElement('p');
        el.className = 'ok';
        return el;
      },
      404: () => {
        const el = document.createElement('p');
        el.className = 'not-found';
        return el;
      },
    });

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.ok')).not.toBeNull();

    code(404);
    await tick();
    expect(container.querySelector('.ok')).toBeNull();
    expect(container.querySelector('.not-found')).not.toBeNull();
  });

  it('works with boolean values (if/else)', async () => {
    const loggedIn = state(false);
    const fragment = match(() => loggedIn(), {
      true: () => {
        const el = document.createElement('p');
        el.className = 'welcome';
        return el;
      },
      false: () => {
        const el = document.createElement('p');
        el.className = 'login';
        return el;
      },
    });

    const container = document.createElement('div');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector('.login')).not.toBeNull();
    expect(container.querySelector('.welcome')).toBeNull();

    loggedIn(true);
    await tick();
    expect(container.querySelector('.login')).toBeNull();
    expect(container.querySelector('.welcome')).not.toBeNull();
  });
});

describe('each', () => {
  it('renders a list of items', async () => {
    const items = state(['A', 'B', 'C']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await tick();
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0].textContent).toBe('A');
    expect(lis[1].textContent).toBe('B');
    expect(lis[2].textContent).toBe('C');
  });

  it('updates when list changes', async () => {
    const items = state(['A', 'B']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll('li').length).toBe(2);

    items(['A', 'B', 'C', 'D']);
    await tick();
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(4);
    expect(lis[3].textContent).toBe('D');
  });

  it('removes items from the list', async () => {
    const items = state(['A', 'B', 'C']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll('li').length).toBe(3);

    items(['A']);
    await tick();
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(1);
    expect(lis[0].textContent).toBe('A');
  });

  it('handles empty list', async () => {
    const items = state([]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll('li').length).toBe(0);
  });

  it('reorders by reversing — exercises LIS path', async () => {
    const items = state(['A', 'B', 'C', 'D']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
      (item) => item,
    );
    const container = document.createElement('ul');
    container.appendChild(fragment);
    await tick();

    items(['D', 'C', 'B', 'A']);
    await tick();
    const lis = container.querySelectorAll('li');
    expect([...lis].map((l) => l.textContent)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('swaps two items in place', async () => {
    const items = state(['A', 'B', 'C', 'D']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
      (item) => item,
    );
    const container = document.createElement('ul');
    container.appendChild(fragment);
    await tick();

    items(['A', 'C', 'B', 'D']);
    await tick();
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'A',
      'C',
      'B',
      'D',
    ]);
  });

  it('replaces all items (no reuse)', async () => {
    const items = state([
      { id: 1, t: 'A' },
      { id: 2, t: 'B' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const container = document.createElement('ul');
    container.appendChild(fragment);
    await tick();

    items([
      { id: 3, t: 'C' },
      { id: 4, t: 'D' },
    ]);
    await tick();
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['C', 'D']);
  });

  it('updates in place when keys match (zero DOM creation)', async () => {
    const items = state([
      { id: 1, t: 'A' },
      { id: 2, t: 'B' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const container = document.createElement('ul');
    container.appendChild(fragment);
    await tick();
    const firstLi = container.querySelector('li');

    items([
      { id: 1, t: 'A' },
      { id: 2, t: 'B' },
    ]);
    await tick();
    expect(container.querySelector('li')).toBe(firstLi);
  });

  it('accepts non-Node mapFn returns (string)', async () => {
    const items = state(['x', 'y']);
    const fragment = each(
      () => items(),
      (item) => item,
    );
    const container = document.createElement('div');
    container.appendChild(fragment);
    await tick();
    expect(container.textContent).toContain('xy');
  });

  it('accepts a fragment from html`` mapFn', async () => {
    const items = state(['x', 'y']);
    const fragment = each(
      () => items(),
      (item) => html`<span>${item}</span>`,
      (item) => item,
    );
    const container = document.createElement('div');
    container.appendChild(fragment);
    await tick();
    expect(container.querySelectorAll('span').length).toBe(2);
  });

  it('disposes when component unmounts', async () => {
    const items = state(['A']);
    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          () => items(),
          (item) => {
            const li = document.createElement('li');
            li.textContent = item;
            return li;
          },
          (item) => item,
        ),
      container,
    );
    await tick();
    expect(container.querySelectorAll('li').length).toBe(1);

    unmount();
    items(['A', 'B', 'C']);
    await tick();
    // After unmount, the watcher is disposed — DOM should not change
    expect(container.querySelectorAll('li').length).toBe(0);
  });
});

describe('match — extra coverage', () => {
  it('caches and reuses DOM for previously-seen keys', async () => {
    const status = state('a');
    const fragment = match(() => status(), {
      a: () => {
        const el = document.createElement('p');
        el.className = 'a';
        return el;
      },
      b: () => {
        const el = document.createElement('p');
        el.className = 'b';
        return el;
      },
    });
    const container = document.createElement('div');
    container.appendChild(fragment);
    await tick();
    const aEl = container.querySelector('.a');

    status('b');
    await tick();
    expect(container.querySelector('.a')).toBeNull();

    status('a');
    await tick();
    // Same node was cached and reattached
    expect(container.querySelector('.a')).toBe(aEl);
  });

  it('handles each() mapFn returning a raw Node (not fragment)', async () => {
    const items = state(['a', 'b']);
    const fragment = each(
      () => items(),
      (item) => {
        const el = document.createElement('span');
        el.textContent = item;
        return el;
      },
      (item) => item,
    );
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();
    expect(c.querySelectorAll('span').length).toBe(2);
  });

  it('renders fragment with multiple children (each first-render path)', async () => {
    const items = state(['a', 'b']);
    const fragment = each(
      () => items(),
      (item) => {
        const frag = document.createDocumentFragment();
        const el1 = document.createElement('span');
        el1.textContent = item;
        const el2 = document.createElement('span');
        el2.textContent = `${item}!`;
        frag.appendChild(el1);
        frag.appendChild(el2);
        return frag;
      },
      (item) => item,
    );
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();
    expect(c.querySelectorAll('span').length).toBe(4);
  });

  it('prepends a single new item (each() prepend fast path)', async () => {
    const items = state([
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();
    const beforeA = c.querySelectorAll('li')[0];

    items([
      { id: 'X', t: 'X' },
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
    ]);
    await tick();
    const lis = c.querySelectorAll('li');
    expect([...lis].map((l) => l.textContent)).toEqual(['X', 'A', 'B']);
    // Existing nodes preserved (no recreate)
    expect(lis[1]).toBe(beforeA);
  });

  it('prepends multiple new items (each() prepend fast path)', async () => {
    const items = state([
      { id: 'C', t: 'C' },
      { id: 'D', t: 'D' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();
    const beforeC = c.querySelectorAll('li')[0];

    items([
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
      { id: 'C', t: 'C' },
      { id: 'D', t: 'D' },
    ]);
    await tick();
    const lis = c.querySelectorAll('li');
    expect([...lis].map((l) => l.textContent)).toEqual(['A', 'B', 'C', 'D']);
    expect(lis[2]).toBe(beforeC);
  });

  it('interleaved insertion falls through to LIS (neither append nor prepend)', async () => {
    // prev = [A, B, C] (prevLen=3); new = [X, A, Y, B, C] (len=5)
    // Length grew, but neither prefix (append) nor suffix (prepend) match —
    // forces a full LIS reorder.
    const items = state([
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
      { id: 'C', t: 'C' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();

    items([
      { id: 'X', t: 'X' },
      { id: 'A', t: 'A' },
      { id: 'Y', t: 'Y' },
      { id: 'B', t: 'B' },
      { id: 'C', t: 'C' },
    ]);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'X',
      'A',
      'Y',
      'B',
      'C',
    ]);
  });

  it('LIS reorder with stable middle item flushes batch (each)', async () => {
    // prev = [A, B, C, D, E], new = [B, C, A, D, E]
    // LIS will keep A's old position (index 0) as a stable point or move it,
    // then iterate D, E as stable, hitting the batch-flush branch (494-497).
    const items = state([
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
      { id: 'C', t: 'C' },
      { id: 'D', t: 'D' },
      { id: 'E', t: 'E' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();

    items([
      { id: 'C', t: 'C' },
      { id: 'A', t: 'A' },
      { id: 'B', t: 'B' },
      { id: 'D', t: 'D' },
      { id: 'E', t: 'E' },
    ]);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'C',
      'A',
      'B',
      'D',
      'E',
    ]);
  });

  it('append-only with key mismatch falls through to LIS', async () => {
    const items = state([
      { id: 1, t: 'A' },
      { id: 2, t: 'B' },
    ]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();

    // Same length; but reorder both so isAppend detection fails midway
    items([
      { id: 2, t: 'B' },
      { id: 1, t: 'A' },
    ]);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['B', 'A']);
  });

  it('disposes match cache on unmount', async () => {
    const status = state('a');
    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        match(() => status(), {
          a: () => {
            const el = document.createElement('p');
            el.className = 'a';
            return el;
          },
        }),
      container,
    );
    await tick();
    expect(container.querySelector('.a')).not.toBeNull();
    unmount();
    expect(container.querySelector('.a')).toBeNull();
  });

  it('renders match view that returns a string (initial + update)', async () => {
    const k = state('a');
    const fragment = match(() => k(), {
      a: () => 'first' as any,
      b: () => 'second' as any,
    });
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();
    expect(c.textContent).toContain('first');

    k('b');
    await tick();
    expect(c.textContent).toContain('second');
    expect(c.textContent).not.toContain('first');
  });

  it('renders match view that returns a fragment with multiple roots', async () => {
    const k = state('a');
    const frag = match(() => k(), {
      a: () => {
        const f = document.createDocumentFragment();
        const e1 = document.createElement('span');
        e1.className = 'm1';
        const e2 = document.createElement('span');
        e2.className = 'm2';
        f.appendChild(e1);
        f.appendChild(e2);
        return f;
      },
      b: () => {
        const f = document.createDocumentFragment();
        const e = document.createElement('span');
        e.className = 'mB';
        f.appendChild(e);
        return f;
      },
    });
    const c = document.createElement('div');
    c.appendChild(frag);
    await tick();
    expect(c.querySelector('.m1')).not.toBeNull();
    expect(c.querySelector('.m2')).not.toBeNull();

    k('b');
    await tick();
    expect(c.querySelector('.m1')).toBeNull();
    expect(c.querySelector('.mB')).not.toBeNull();
  });

  it('match() with no fallback and unknown initial key renders nothing', async () => {
    const k = state('zzz');
    const frag = match(() => k(), {
      a: () => {
        const el = document.createElement('p');
        el.className = 'a';
        return el;
      },
    });
    const c = document.createElement('div');
    c.appendChild(frag);
    await tick();
    expect(c.querySelector('.a')).toBeNull();

    // Switch to known key
    k('a');
    await tick();
    expect(c.querySelector('.a')).not.toBeNull();
  });
});

describe('when()', () => {
  it('renders thenFn when condition is true, elseFn when false', async () => {
    const { when } = await import('../src/control.ts');
    const cond = state(true);
    const frag = when(
      () => cond(),
      () => {
        const el = document.createElement('p');
        el.className = 'yes';
        return el;
      },
      () => {
        const el = document.createElement('p');
        el.className = 'no';
        return el;
      },
    );
    const c = document.createElement('div');
    c.appendChild(frag);
    await tick();
    expect(c.querySelector('.yes')).not.toBeNull();

    cond(false);
    await tick();
    expect(c.querySelector('.yes')).toBeNull();
    expect(c.querySelector('.no')).not.toBeNull();
  });

  it('renders nothing when false and no elseFn', async () => {
    const { when } = await import('../src/control.ts');
    const cond = state(false);
    const frag = when(
      () => cond(),
      () => {
        const el = document.createElement('p');
        el.className = 'yes';
        return el;
      },
    );
    const c = document.createElement('div');
    c.appendChild(frag);
    await tick();
    expect(c.querySelector('.yes')).toBeNull();

    cond(true);
    await tick();
    expect(c.querySelector('.yes')).not.toBeNull();
  });
});

describe('each — extractNodes paths via update', () => {
  it('adds new entries with multi-child fragment via update', async () => {
    const items = state(['A']);
    const fragment = each(
      () => items(),
      (item) => {
        const f = document.createDocumentFragment();
        const e1 = document.createElement('span');
        e1.textContent = `${item}1`;
        const e2 = document.createElement('span');
        e2.textContent = `${item}2`;
        f.appendChild(e1);
        f.appendChild(e2);
        return f;
      },
      (item) => item,
    );
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();
    expect(c.querySelectorAll('span').length).toBe(2);

    items(['A', 'B']);
    await tick();
    expect(c.querySelectorAll('span').length).toBe(4);
    expect(c.textContent).toContain('A1');
    expect(c.textContent).toContain('B2');
  });

  it('adds new entries with single Node via update', async () => {
    const items = state(['A']);
    const fragment = each(
      () => items(),
      (item) => {
        const el = document.createElement('span');
        el.textContent = item;
        return el;
      },
      (item) => item,
    );
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();

    items(['A', 'B']);
    await tick();
    expect(c.querySelectorAll('span').length).toBe(2);
  });

  it('adds new entries with string return via update', async () => {
    const items = state(['A']);
    const fragment = each(
      () => items(),
      (item) => item,
      (item) => item,
    );
    const c = document.createElement('div');
    c.appendChild(fragment);
    await tick();

    items(['A', 'B']);
    await tick();
    expect(c.textContent).toContain('B');
  });
});

describe('each — LIS binary search exercise', () => {
  it('handles 7-item shuffle that exercises LIS binary search', async () => {
    const items = state(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => ({ id, t: id })));
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item.t;
        return li;
      },
      (item) => item.id,
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();

    // Reorder: indices [2, 4, 1, 3, 5, 0, 6] — exercises both BS branches
    items(['C', 'E', 'B', 'D', 'F', 'A', 'G'].map((id) => ({ id, t: id })));
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'C',
      'E',
      'B',
      'D',
      'F',
      'A',
      'G',
    ]);
  });
});

describe('each — no keyFn (item identity)', () => {
  it('uses item identity when keyFn omitted', async () => {
    const items = state(['a', 'b', 'c']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      },
    );
    const c = document.createElement('ul');
    c.appendChild(fragment);
    await tick();
    expect(c.querySelectorAll('li').length).toBe(3);

    items(['a', 'b', 'd']);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['a', 'b', 'd']);
  });
});
