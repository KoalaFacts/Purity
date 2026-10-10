import { describe, expect, it, vi } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { ComponentContext, mount, onDispose, popContext, pushContext } from '../src/component.ts';
import {
  each,
  eachSSR,
  inflateDeferredEach,
  list,
  listSSR,
  match,
  type DeferredEach,
} from '../src/control.ts';
import { state, watch } from '../src/signals.ts';

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
        li.textContent = item();
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

  it('renders only a small initial range when virtual rendering is enabled', async () => {
    const items = state(Array.from({ length: 100 }, (_, index) => index));
    const renderedIndices: number[] = [];
    const fragment = each(
      () => items(),
      (item, index) => {
        renderedIndices.push(index);
        const li = document.createElement('li');
        li.textContent = String(item());
        return li;
      },
      { virtual: true },
    );

    expect(renderedIndices).toHaveLength(40);
    expect(renderedIndices[0]).toBe(0);
    expect(renderedIndices[39]).toBe(39);
    expect(fragment.querySelectorAll('li')).toHaveLength(40);
    expect(fragment.querySelectorAll('[data-purity-window-spacer]')).toHaveLength(2);
    expect(
      (fragment.querySelectorAll('[data-purity-window-spacer]')[1] as HTMLElement).style.height,
    ).toBe('1920px');

    items([...items(), 100]);
    await tick();
    expect(renderedIndices).toHaveLength(40);
    expect(
      (fragment.querySelectorAll('[data-purity-window-spacer]')[1] as HTMLElement).style.height,
    ).toBe('1952px');
  });

  it('starts observing when an unowned fragment is mounted after a delay', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'height:96px;overflow-y:auto';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 96 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 96);
    const fragment = each(
      Array.from({ length: 100 }, (_, index) => index),
      (_item, index) => {
        const row = document.createElement('div');
        row.textContent = String(index);
        row.getBoundingClientRect = () => new DOMRect(0, index * 24 - container.scrollTop, 200, 24);
        return row;
      },
      { virtual: true },
    );

    await tick();
    document.body.appendChild(container);
    container.appendChild(fragment);
    await tick();
    await tick();
    const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    container.scrollTop = 1200;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(Array.from(container.children).some((row) => row.textContent === '50')).toBe(true);
    container.remove();
  });

  it('includes rows matching the initial height estimate in the measured average', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'height:96px;overflow-y:auto';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 96 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 96);
    const mounted = mount(
      () =>
        each(
          Array.from({ length: 100 }, (_, index) => index),
          (_item, index) => {
            const row = document.createElement('div');
            row.dataset.row = String(index);
            const height = index % 2 === 0 ? 32 : 64;
            const top = Math.floor(index / 2) * 96 + (index % 2) * 32;
            row.getBoundingClientRect = () => new DOMRect(0, top, 200, height);
            return row;
          },
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();

    const spacers = container.querySelectorAll<HTMLElement>('[data-purity-window-spacer]');
    const renderedHeight = Array.from(container.querySelectorAll('[data-row]')).reduce(
      (total, row) => total + row.getBoundingClientRect().height,
      0,
    );
    const totalHeight =
      Number.parseFloat(spacers[0].style.height) +
      renderedHeight +
      Number.parseFloat(spacers[1].style.height);
    expect(totalHeight).toBe(4800);
    mounted.unmount();
  });

  it('updates the rendered range from the nearest scroll container and cleans up on unmount', async () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const renderedIndices: number[] = [];
    const container = document.createElement('ul');
    container.style.overflowY = 'auto';
    container.style.height = '96px';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 96 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 96);

    const mounted = mount(
      () =>
        each(
          items,
          (item, index) => {
            renderedIndices.push(index);
            const li = document.createElement('li');
            li.textContent = String(index);
            li.getBoundingClientRect = () =>
              new DOMRect(0, index * 24 - container.scrollTop, 200, 24);
            return li;
          },
          (item) => item,
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();
    const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    expect(topSpacer.localName).toBe('li');
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    expect(container.querySelectorAll('li:not([data-purity-window-spacer])')).toHaveLength(12);

    container.scrollTop = 1200;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();
    const rows = container.querySelectorAll('li:not([data-purity-window-spacer])');
    expect(rows[0].textContent).toBe('42');
    expect(rows[rows.length - 1].textContent).toBe('61');

    mounted.unmount();
    const renderCountAfterUnmount = renderedIndices.length;
    container.scrollTop = 0;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(renderedIndices).toHaveLength(renderCountAfterUnmount);
  });

  it('keeps the scroll range accurate when row heights vary', async () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const container = document.createElement('ul');
    container.style.overflowY = 'auto';
    container.style.height = '100px';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    const rowOffset = (index: number) => Math.floor(index / 2) * 60 + (index % 2) * 20;

    const mounted = mount(
      () =>
        each(
          items,
          (_item, index) => {
            const li = document.createElement('li');
            li.textContent = String(index);
            const height = index % 2 === 0 ? 20 : 40;
            li.getBoundingClientRect = () =>
              new DOMRect(0, rowOffset(index) - container.scrollTop, 200, height);
            return li;
          },
          (item) => item,
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();

    const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    container.scrollTop = rowOffset(20);
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    const rows = Array.from(container.querySelectorAll('li:not([data-purity-window-spacer])'));
    const indices = rows.map((row) => Number(row.textContent));
    expect(indices[0]).toBe(12);
    expect(indices).toContain(20);
    expect(indices.length).toBeLessThan(40);

    mounted.unmount();
  });

  it('recalculates the visible range when reactive row content changes its height', async () => {
    const items = state(Array.from({ length: 100 }, (_, id) => ({ id, label: 'x' })));
    const container = document.createElement('ul');
    container.style.overflowY = 'auto';
    container.style.height = '100px';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    const heightOf = (label: string) => (label.length > 1 ? 60 : 20);

    const mounted = mount(
      () =>
        each(
          () => items(),
          (item) => {
            const id = item().id;
            const li = document.createElement('li');
            li.dataset.row = String(id);
            li.appendChild(html`<span>${() => item().label}</span>`);
            li.getBoundingClientRect = () => {
              const current = items();
              const index = current.findIndex((row) => row.id === id);
              let top = 0;
              for (let i = 0; i < index; i++) top += heightOf(current[i].label);
              return new DOMRect(0, top - container.scrollTop, 200, heightOf(current[index].label));
            };
            return li;
          },
          (item) => item.id,
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();

    const spacers = container.querySelectorAll<HTMLElement>('[data-purity-window-spacer]');
    const topSpacer = spacers[0];
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    container.scrollTop = 400;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();
    const heightOfWindow = () => {
      const rows = Array.from(container.querySelectorAll('li:not([data-purity-window-spacer])'));
      return (
        Number.parseFloat(spacers[0].style.height) +
        rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0) +
        Number.parseFloat(spacers[1].style.height)
      );
    };
    const initialHeight = heightOfWindow();
    const targetId = Number(
      container.querySelector('li:not([data-purity-window-spacer])')?.getAttribute('data-row'),
    );

    items(items().map((row) => (row.id === targetId ? { ...row, label: 'expanded' } : row)));
    await tick();
    expect(container.querySelector(`li[data-row="${targetId}"]`)?.textContent).toBe('expanded');
    container.ownerDocument.defaultView!.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    expect(heightOfWindow()).toBe(initialHeight + 40);
    mounted.unmount();
  });

  it('renders newly inserted rows at the current scroll position', async () => {
    const items = state(Array.from({ length: 100 }, (_, id) => id));
    const container = document.createElement('ul');
    container.style.overflowY = 'auto';
    container.style.height = '100px';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);

    const mounted = mount(
      () =>
        each(
          () => items(),
          (item) => {
            const id = item();
            const li = document.createElement('li');
            li.dataset.row = String(id);
            li.textContent = String(id);
            li.getBoundingClientRect = () =>
              new DOMRect(0, items().indexOf(id) * 20 - container.scrollTop, 200, 20);
            return li;
          },
          (item) => item,
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();

    const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    container.scrollTop = 800;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    items([...items().slice(0, 40), 100, 101, 102, ...items().slice(40)]);
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    const renderedRows = Array.from(
      container.querySelectorAll('li:not([data-purity-window-spacer])'),
    );
    const renderedIds = renderedRows.map((row) => Number(row.getAttribute('data-row')));
    expect(renderedIds).toContain(100);
    expect(renderedIds).toContain(40);
    mounted.unmount();
  });

  it('keeps the scroll window aligned after visible rows are removed', async () => {
    const items = state(Array.from({ length: 100 }, (_, id) => id));
    const container = document.createElement('ul');
    container.style.overflowY = 'auto';
    container.style.height = '100px';
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);

    const mounted = mount(
      () =>
        each(
          () => items(),
          (item) => {
            const id = item();
            const li = document.createElement('li');
            li.dataset.row = String(id);
            li.textContent = String(id);
            li.getBoundingClientRect = () =>
              new DOMRect(0, items().indexOf(id) * 20 - container.scrollTop, 200, 20);
            return li;
          },
          (item) => item,
          { virtual: true },
        ),
      container,
    );
    await tick();
    await tick();

    const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
    container.scrollTop = 800;
    container.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    items(items().filter((id) => id < 40 || id > 42));
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tick();
    await tick();

    const renderedRows = Array.from(
      container.querySelectorAll('li:not([data-purity-window-spacer])'),
    );
    const renderedIds = renderedRows.map((row) => Number(row.getAttribute('data-row')));
    expect(renderedIds).toContain(43);
    expect(renderedIds).not.toContain(40);
    expect(renderedIds).not.toContain(41);
    expect(renderedIds).not.toContain(42);
    mounted.unmount();
  });

  it('adopts SSR rows and windows them during hydration', async () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const host = document.createElement('ul');
    host.style.overflowY = 'auto';
    host.style.height = '1024px';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 1024 });
    const serverRows = items
      .map((item) => `<!--er:${item}--><li><!--[-->${item}<!--]--></li><!--/er-->`)
      .join('');
    host.innerHTML = `<!--e-->${serverRows}<!--/e-->`;
    document.body.appendChild(host);
    const closeMarker = document.createComment('slot-close');
    host.appendChild(closeMarker);
    const context = new ComponentContext();
    const deferred: DeferredEach<number> = {
      __purity_deferred_each__: true,
      listAccessor: items,
      mapFn: (item) => html`<li>${item()}</li>`,
      keyFn: (item) => item,
      options: { virtual: true },
    };

    pushContext(context);
    try {
      inflateDeferredEach(deferred, Array.from(host.childNodes).slice(0, -1), closeMarker);
    } finally {
      popContext();
    }
    await tick();

    expect(host.querySelectorAll('li[data-purity-window-spacer]')).toHaveLength(2);
    const rows = host.querySelectorAll('li:not([data-purity-window-spacer])');
    expect(rows).toHaveLength(40);
    expect(rows[0].textContent).toBe('0');
    expect(rows[39].textContent).toBe('39');

    for (const dispose of context.disposers ?? []) dispose();
    host.remove();
  });

  it('places the hydration spacer before a row keyed by undefined', async () => {
    const items = [undefined, ...Array.from({ length: 99 }, (_, index) => index + 1)];
    const host = document.createElement('ul');
    host.style.cssText = 'height:1024px;overflow-y:auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 1024 });
    host.innerHTML = `<!--e-->${items
      .map((item) => `<!--er:${item}--><li><!--[-->${item ?? ''}<!--]--></li><!--/er-->`)
      .join('')}<!--/e-->`;
    document.body.appendChild(host);
    const closeMarker = document.createComment('slot-close');
    host.appendChild(closeMarker);
    const context = new ComponentContext();
    const deferred: DeferredEach<number | undefined> = {
      __purity_deferred_each__: true,
      listAccessor: items,
      mapFn: (item) => html`<li>${item()}</li>`,
      options: { virtual: true },
    };

    pushContext(context);
    try {
      inflateDeferredEach(deferred, Array.from(host.childNodes).slice(0, -1), closeMarker);
    } finally {
      popContext();
    }
    await tick();
    expect(host.firstElementChild?.hasAttribute('data-purity-window-spacer')).toBe(true);
    expect(host.querySelectorAll('li:not([data-purity-window-spacer])')).toHaveLength(40);
    for (const dispose of context.disposers ?? []) dispose();
    host.remove();
  });

  it('updates when list changes', async () => {
    const items = state(['A', 'B']);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement('li');
        li.textContent = item();
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
        li.textContent = item();
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
        li.textContent = item();
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
        li.textContent = item();
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
        li.textContent = item();
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
        li.textContent = item().t;
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
        li.textContent = item().t;
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

  it('updates rendered content when keys match but item data differs', async () => {
    const items = state([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const c = document.createElement('ul');
    c.appendChild(
      each(
        () => items(),
        (item) => html`<li>${() => item().text}</li>`,
        (item) => item.id,
      ),
    );
    await tick();
    const firstLi = c.querySelector('li');
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['A', 'B']);

    items([
      { id: 1, text: 'A-updated' },
      { id: 2, text: 'B-updated' },
    ]);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'A-updated',
      'B-updated',
    ]);
    // DOM identity preserved — same nodes, just signal updates
    expect(c.querySelector('li')).toBe(firstLi);
  });

  it('accepts non-Node mapFn returns (string)', async () => {
    const items = state(['x', 'y']);
    const fragment = each(
      () => items(),
      (item) => item(),
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
      (item) => html`<span>${item()}</span>`,
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
            li.textContent = item();
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
  it('renders a previously-seen key fresh instead of reattaching disposed DOM', async () => {
    const status = state('a');
    let aRenders = 0;
    const fragment = match(() => status(), {
      a: () => {
        aRenders++;
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
    // The hidden case was disposed, so showing it again renders a new view.
    expect(aRenders).toBe(2);
    expect(container.querySelector('.a')).not.toBeNull();
    expect(container.querySelector('.a')).not.toBe(aEl);
  });

  it('handles each() mapFn returning a raw Node (not fragment)', async () => {
    const items = state(['a', 'b']);
    const fragment = each(
      () => items(),
      (item) => {
        const el = document.createElement('span');
        el.textContent = item();
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
        el1.textContent = item();
        const el2 = document.createElement('span');
        el2.textContent = `${item()}!`;
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
        li.textContent = item().t;
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
        li.textContent = item().t;
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
        li.textContent = item().t;
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
        li.textContent = item().t;
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
        li.textContent = item().t;
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
        e1.textContent = `${item()}1`;
        const e2 = document.createElement('span');
        e2.textContent = `${item()}2`;
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
        el.textContent = item();
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
      (item) => item(),
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
        li.textContent = item().t;
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
        li.textContent = item();
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

describe('each — entry disposer registration (leak regression)', () => {
  it('runs onDispose() registered inside mapFn when entry is removed', async () => {
    const items = state([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const disposed: number[] = [];
    const c = document.createElement('ul');
    c.appendChild(
      each(
        () => items(),
        (item: () => { id: number }) => {
          const li = document.createElement('li');
          li.textContent = String(item().id);
          // onDispose registers with the current ComponentContext. After the
          // each() entry-context fix, that context is the per-entry one, so
          // this fires when the entry is removed (not when the outer scope
          // unmounts).
          const id = item().id;
          onDispose(() => disposed.push(id));
          return li;
        },
        (item: { id: number }) => item.id,
      ),
    );
    await tick();
    expect(disposed).toEqual([]);

    items([{ id: 1 }, { id: 3 }]);
    await tick();
    expect(disposed).toEqual([2]);

    items([{ id: 1 }]);
    await tick();
    expect(disposed.sort()).toEqual([2, 3]);
  });

  it('disposes all entries on bulk clear (full -> empty)', async () => {
    let disposeCount = 0;
    const items = state(Array.from({ length: 25 }, (_, i) => ({ id: i })));
    const c = document.createElement('ul');
    c.appendChild(
      each(
        () => items(),
        (item: () => { id: number }) => {
          const li = document.createElement('li');
          li.textContent = String(item().id);
          onDispose(() => disposeCount++);
          return li;
        },
        (item: { id: number }) => item.id,
      ),
    );
    await tick();
    expect(disposeCount).toBe(0);

    items([]);
    await tick();
    expect(disposeCount).toBe(25);
  });

  it('reactive watch handles inside the entry are unwatched on removal', async () => {
    // Indirect proof: count how many times a reactive binding's body runs
    // for an item AFTER it has been removed from the list. With the leak,
    // the entry's watch stays registered with the global watcher and re-runs
    // on subsequent flushes; with the fix, it is unwatched and never re-runs.
    const items = state([{ id: 1 }, { id: 2 }]);
    const externalSig = state(0);
    const runs: number[] = []; // ids of items whose binding ran
    const c = document.createElement('ul');
    c.appendChild(
      each(
        () => items(),
        (item: () => { id: number }) => {
          const li = document.createElement('li');
          watch(() => {
            externalSig();
            runs.push(item().id);
          });
          return li;
        },
        (item: { id: number }) => item.id,
      ),
    );
    await tick();
    expect(runs.sort()).toEqual([1, 2]);
    runs.length = 0;

    // Remove item 2
    items([{ id: 1 }]);
    await tick();
    runs.length = 0;

    // Pulse externalSig — only item 1's binding should re-run
    externalSig(1);
    await tick();
    expect(runs).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// ADR 0023 — isomorphic conditional primitives
//
// `when()` / `match()` / `each()` auto-detect the SSR render context and
// dispatch to their SSR variants when set. This means the unsuffixed names
// are safe to call from manifest-driven composers without crashing on
// `document is not defined`.
// ---------------------------------------------------------------------------

import { each as eachIso, match as matchIso, when as whenIso } from '../src/control.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

function inSSRContext<T>(fn: () => T): T {
  pushSSRRenderContext(makeSSRContext());
  try {
    return fn();
  } finally {
    popSSRRenderContext();
  }
}

// SSRHtml is `{ __purity_ssr_html__: string }`; helper to extract the markup.
function ssrHtmlText(v: unknown): string {
  return (v as { __purity_ssr_html__: string }).__purity_ssr_html__;
}

describe('match — SSR-context dispatch (ADR 0023)', () => {
  it('returns SSRHtml when called inside an SSR render context', () => {
    const result = inSSRContext(() =>
      matchIso(() => 'a' as 'a' | 'b', {
        a: () => 'left',
        b: () => 'right',
      }),
    );
    const html = ssrHtmlText(result);
    expect(html).toContain('left');
    expect(html).toContain('<!--m:');
  });

  it('returns a DocumentFragment when called outside an SSR context', () => {
    const result = matchIso(() => 'a' as 'a' | 'b', {
      a: () => 'left',
      b: () => 'right',
    });
    expect(result).toBeInstanceOf(DocumentFragment);
  });
});

describe('when — SSR-context dispatch (ADR 0023)', () => {
  it('returns SSRHtml when called inside an SSR render context', () => {
    const result = inSSRContext(() =>
      whenIso(
        () => true,
        () => 'shown',
        () => 'hidden',
      ),
    );
    const html = ssrHtmlText(result);
    expect(html).toContain('shown');
    expect(html).toContain('<!--m:true-->');
  });

  it('returns the elseFn branch in SSR when condition is false', () => {
    const result = inSSRContext(() =>
      whenIso(
        () => false,
        () => 'shown',
        () => 'hidden',
      ),
    );
    const html = ssrHtmlText(result);
    expect(html).toContain('hidden');
    expect(html).toContain('<!--m:false-->');
  });

  it('returns a DocumentFragment when called outside an SSR context', () => {
    const result = whenIso(
      () => true,
      () => 'shown',
    );
    expect(result).toBeInstanceOf(DocumentFragment);
  });
});

describe('each — SSR-context dispatch (ADR 0023)', () => {
  it('returns SSRHtml when called inside an SSR render context', () => {
    // Plain-string mapFn returns are HTML-escaped by valueToHtml — that's
    // the existing eachSSR contract. Use the escaped form in the assertion.
    const result = inSSRContext(() => eachIso([1, 2, 3], (item) => `<li>${item()}</li>`));
    const html = ssrHtmlText(result);
    expect(html).toContain('&lt;li&gt;1&lt;/li&gt;');
    expect(html).toContain('&lt;li&gt;2&lt;/li&gt;');
    expect(html).toContain('&lt;li&gt;3&lt;/li&gt;');
    // eachSSR's per-row marker grammar.
    expect(html).toMatch(/<!--er:[^-]+-->/);
    expect(html).toContain('<!--/er-->');
  });

  it('keeps the complete list in SSR when virtual rendering is enabled', () => {
    const result = inSSRContext(() =>
      eachIso(
        Array.from({ length: 100 }, (_, index) => index),
        (item) => `<li>${item()}</li>`,
        { virtual: true },
      ),
    );
    const html = ssrHtmlText(result);
    expect(html.match(/<!--er:/g)).toHaveLength(100);
    expect(html).not.toContain('data-purity-window-spacer');
  });

  it('returns a DocumentFragment when called outside an SSR context', () => {
    const result = eachIso([1, 2], (item) => {
      const li = document.createElement('li');
      li.textContent = String(item());
      return li;
    });
    expect(result).toBeInstanceOf(DocumentFragment);
  });

  it('emits the eachSSR boundary marker grammar in SSR (no document.createComment)', () => {
    // Regression for the gap surfaced by the examples/ssr migration: calling
    // each() inside an SSR pass should dispatch to eachSSR rather than reach
    // for document.createComment (which crashes on the server). Asserting
    // the boundary-marker prefix proves the dispatch went through SSR.
    const result = inSSRContext(() => eachIso([1], (i) => `<li>${i()}</li>`));
    expect(ssrHtmlText(result)).toMatch(/^<!--e-->/);
  });
});

// ---------------------------------------------------------------------------
// Audit regressions — Pass 1 HIGH/MED + Pass 3 MED fixes for control.ts.
// Each block locks in the documented contract for the corresponding finding
// so a future refactor can't silently regress.
// ---------------------------------------------------------------------------

describe('each() — duplicate keyFn warning (audit Pass 1 HIGH)', () => {
  it('warns on reconcile when keyFn yields duplicate keys', async () => {
    // Start with a unique-key render so the reconcile path is taken on the
    // next update (the prevLen===0 first-render branch is intentionally
    // light — duplicate detection lives in the reorder path where the
    // duplicates actually corrupt the row mapping).
    const items = state<{ id: number; t: string }[]>([{ id: 0, t: 'init' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = document.createElement('ul');
      c.appendChild(
        each(
          () => items(),
          (item: () => { id: number; t: string }) => {
            const li = document.createElement('li');
            li.textContent = item().t;
            return li;
          },
          (item: { id: number; t: string }) => item.id,
        ),
      );
      await tick();
      expect(warn).not.toHaveBeenCalled();

      // Trigger reconcile with duplicate keys — the warning is documented.
      items([
        { id: 1, t: 'A' },
        { id: 1, t: 'B' },
        { id: 2, t: 'C' },
      ]);
      await tick();
      expect(warn).toHaveBeenCalled();
      const msg = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(msg).toContain('duplicate key');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('list() — event handler rebind on key reuse (audit Pass 1 HIGH)', () => {
  it('rebinds event handlers with fresh item when key is reused with new data', async () => {
    type Row = { id: number; name: string };
    const items = state<Row[]>([{ id: 1, name: 'first' }]);
    const fired: string[] = [];
    const c = document.createElement('ul');
    c.appendChild(
      list<Row>('li', () => items(), {
        text: (r) => r.name,
        events: {
          click: (r) => () => fired.push(r.name),
        },
        key: (r) => r.id,
      }),
    );
    await tick();

    // First click → handler closes over name='first'.
    (c.querySelector('li') as HTMLElement).click();
    expect(fired).toEqual(['first']);

    // Same id, new payload — entry should be reused but the handler must be
    // re-bound against the fresh item, not the stale 'first' snapshot.
    items([{ id: 1, name: 'second' }]);
    await tick();
    (c.querySelector('li') as HTMLElement).click();
    expect(fired).toEqual(['first', 'second']);
  });
});

describe('list() — null/undefined attr resolver matches SSR (audit Pass 1 MED)', () => {
  it('omits the attribute when the resolver returns null/undefined', async () => {
    type Row = { id: number; title: string | null };
    const items = state<Row[]>([{ id: 1, title: 'hi' }]);
    const c = document.createElement('ul');
    c.appendChild(
      list<Row>('li', () => items(), {
        attrs: { title: (r) => r.title as string },
        key: (r) => r.id,
      }),
    );
    await tick();
    const li = c.querySelector('li') as HTMLElement;
    expect(li.getAttribute('title')).toBe('hi');

    // Resolver returns null — attribute should be REMOVED on update, not set
    // to the literal string "null" (which is what the unguarded setAttribute
    // path produced before the fix).
    items([{ id: 1, title: null }]);
    await tick();
    expect(li.hasAttribute('title')).toBe(false);
  });
});

describe('list() — dispose releases event listeners (audit Pass 1 MED)', () => {
  it('releases bound event handlers on owner unmount', async () => {
    type Row = { id: number };
    const items = state<Row[]>([{ id: 1 }]);
    const fired: number[] = [];
    const root = document.createElement('div');
    const handle = mount(
      () =>
        html`${list<Row>('li', () => items(), {
          text: (r) => String(r.id),
          events: { click: (r) => () => fired.push(r.id) },
          key: (r) => r.id,
        })}`,
      root,
    );
    await tick();
    const li = root.querySelector('li') as HTMLElement;
    li.click();
    expect(fired).toEqual([1]);

    // After unmount, the bound handler must be removed — a subsequent click
    // on the still-rooted node should not fire (we re-attach to document so
    // the click can dispatch).
    handle.unmount();
    document.body.appendChild(li);
    try {
      li.click();
      expect(fired).toEqual([1]); // unchanged
    } finally {
      li.remove();
    }
  });
});

describe('list() — throwing attr/event resolver isolation (audit Pass 3 MED)', () => {
  it('isolates a throwing getAttrs resolver from sibling attrs', async () => {
    type Row = { id: number };
    const items = state<Row[]>([{ id: 1 }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const c = document.createElement('ul');
      c.appendChild(
        list<Row>('li', () => items(), {
          attrs: {
            'data-bad': () => {
              throw new Error('boom');
            },
            'data-good': () => 'ok',
          },
          key: (r) => r.id,
        }),
      );
      await tick();
      const li = c.querySelector('li') as HTMLElement;
      // Sibling attr survives the throw.
      expect(li.getAttribute('data-good')).toBe('ok');
      expect(li.hasAttribute('data-bad')).toBe(false);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it('isolates a throwing getEvents resolver from sibling events', async () => {
    type Row = { id: number };
    const items = state<Row[]>([{ id: 1 }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fired: string[] = [];
    try {
      const c = document.createElement('ul');
      c.appendChild(
        list<Row>('li', () => items(), {
          events: {
            click: () => {
              throw new Error('boom');
            },
            mouseenter: () => () => fired.push('mouseenter'),
          },
          key: (r) => r.id,
        }),
      );
      await tick();
      const li = c.querySelector('li') as HTMLElement;
      // The throwing event resolver does NOT prevent the sibling from binding.
      li.dispatchEvent(new Event('mouseenter'));
      expect(fired).toEqual(['mouseenter']);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });
});

describe('each() — duplicate keys never leave stale rows or live scopes', () => {
  type Row = { id: number };
  const renderRow = (item: () => Row) => {
    const li = document.createElement('li');
    li.textContent = String(item().id);
    return li;
  };
  const rowTexts = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('li')).map((li) => li.textContent);

  it('clears to an empty DOM after a reconcile with a duplicate key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = state<Row[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const c = document.createElement('ul');
      c.appendChild(
        each(
          () => items(),
          renderRow,
          (item: Row) => item.id,
        ),
      );
      await tick();

      items([{ id: 1 }, { id: 1 }, { id: 3 }]);
      await tick();
      items([]);
      await tick();

      expect(c.querySelectorAll('li').length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('clears to an empty DOM when the initial render contained a duplicate key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = state<Row[]>([{ id: 1 }, { id: 1 }, { id: 2 }]);
      const c = document.createElement('ul');
      c.appendChild(
        each(
          () => items(),
          renderRow,
          (item: Row) => item.id,
        ),
      );
      await tick();

      items([]);
      await tick();

      expect(c.querySelectorAll('li').length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('removes the row whose key was dropped when a duplicate key is present', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = state<Row[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const c = document.createElement('ul');
      c.appendChild(
        each(
          () => items(),
          renderRow,
          (item: Row) => item.id,
        ),
      );
      await tick();

      items([{ id: 1 }, { id: 1 }, { id: 3 }]);
      await tick();

      expect(rowTexts(c)).toEqual(['1', '3']);
    } finally {
      warn.mockRestore();
    }
  });

  it('disposes the scope of a new row shadowed by a duplicate key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pulse = state(0);
      const runs: number[] = [];
      const items = state<Row[]>([{ id: 1 }]);
      const c = document.createElement('ul');
      c.appendChild(
        each(
          () => items(),
          (item: () => Row) => {
            const li = renderRow(item);
            const id = item().id;
            watch(() => {
              pulse();
              runs.push(id);
            });
            return li;
          },
          (item: Row) => item.id,
        ),
      );
      await tick();

      // Key 2 is new and appears twice: the second occurrence must not
      // silently replace (and orphan) the first occurrence's scope.
      items([{ id: 2 }, { id: 2 }]);
      await tick();
      items([]);
      await tick();

      runs.length = 0;
      pulse(1);
      await tick();
      expect(runs).toEqual([]);
      expect(c.querySelectorAll('li').length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps node identity and order for unique-key removals and reorders', async () => {
    const items = state<Row[]>([1, 2, 3, 4, 5].map((id) => ({ id })));
    const c = document.createElement('ul');
    c.appendChild(
      each(
        () => items(),
        renderRow,
        (item: Row) => item.id,
      ),
    );
    await tick();

    const before = new Map(
      Array.from(c.querySelectorAll('li')).map((li) => [li.textContent, li] as const),
    );

    items([5, 3, 1].map((id) => ({ id })));
    await tick();
    expect(rowTexts(c)).toEqual(['5', '3', '1']);
    expect(c.querySelectorAll('li')[0]).toBe(before.get('5'));
    expect(c.querySelectorAll('li')[1]).toBe(before.get('3'));
    expect(c.querySelectorAll('li')[2]).toBe(before.get('1'));

    items([5, 3, 1, 7].map((id) => ({ id })));
    await tick();
    expect(rowTexts(c)).toEqual(['5', '3', '1', '7']);
    expect(c.querySelectorAll('li')[2]).toBe(before.get('1'));

    items([]);
    await tick();
    expect(c.querySelectorAll('li').length).toBe(0);
  });
});

describe('list() — duplicate keys never leave stale rows', () => {
  type Row = { id: number };
  const texts = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('li')).map((li) => li.textContent);

  it('clears to an empty DOM after a reconcile with a duplicate key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = state<Row[]>([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const c = document.createElement('ul');
      c.appendChild(
        list<Row>(
          'li',
          () => items(),
          (r) => String(r.id),
          (r) => r.id,
        ),
      );
      await tick();

      items([{ id: 1 }, { id: 1 }, { id: 3 }]);
      await tick();
      expect(texts(c)).toEqual(['1', '3']);

      items([]);
      await tick();
      expect(c.querySelectorAll('li').length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('clears to an empty DOM when the initial render contained a duplicate key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const items = state<Row[]>([{ id: 1 }, { id: 1 }, { id: 2 }]);
      const c = document.createElement('ul');
      c.appendChild(
        list<Row>(
          'li',
          () => items(),
          (r) => String(r.id),
          (r) => r.id,
        ),
      );
      await tick();

      items([]);
      await tick();
      expect(c.querySelectorAll('li').length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('each() / list() — duplicate keys render first-occurrence order', () => {
  type Row = { id: number };
  const firstOccurrence = (ids: number[]) => [...new Set(ids)];

  const mounts: Array<[string, (items: () => Row[]) => HTMLElement]> = [
    [
      'each()',
      (items) => {
        const c = document.createElement('ul');
        c.appendChild(
          each(
            () => items(),
            (item: () => Row) => {
              const li = document.createElement('li');
              li.textContent = String(item().id);
              return li;
            },
            (item: Row) => item.id,
          ),
        );
        return c;
      },
    ],
    [
      'list()',
      (items) => {
        const c = document.createElement('ul');
        c.appendChild(
          list<Row>(
            'li',
            () => items(),
            (r) => String(r.id),
            (r) => r.id,
          ),
        );
        return c;
      },
    ],
  ];

  for (const [name, mount] of mounts) {
    it(`${name} renders keys in first-occurrence order across duplicate-key sequences`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const items = state<Row[]>([]);
        const c = mount(items);
        // Split into the three independent runs the bug report uses.
        const runs = [
          [[1, 2, 3], [1, 3, 1], [3, 1], [2, 1, 2, 3], []],
          [[], [5, 5, 5], [5, 6, 5], [6, 5], [1, 2, 3, 4, 5, 6], [6, 2, 3, 4, 5, 1, 6]],
          [
            [1, 2, 3, 4, 5],
            [1, 4, 3, 2, 5, 4],
            [5, 4, 3, 2, 1],
          ],
        ];
        for (const run of runs) {
          for (const ids of run) {
            items(ids.map((id) => ({ id })));
            await tick();
            const got = Array.from(c.querySelectorAll('li')).map((li) => li.textContent);
            expect(got).toEqual(firstOccurrence(ids).map(String));
          }
        }
      } finally {
        warn.mockRestore();
      }
    });
  }
});

describe('duplicate keys — initial render, SSR and hydration', () => {
  type Row = { id: number; v: string };
  const warnSpy = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  for (const name of ['each()', 'list()'] as const) {
    it(`${name} keeps the first occurrence's data after a same-key update that follows a duplicate initial render`, async () => {
      const warn = warnSpy();
      try {
        const items = state<Row[]>([
          { id: 1, v: 'a' },
          { id: 1, v: 'b' },
        ]);
        const c = document.createElement('ul');
        if (name === 'each()') {
          c.appendChild(
            each(
              () => items(),
              (item: () => Row) => html`<li>${() => item().v}</li>`,
              (item: Row) => item.id,
            ),
          );
        } else {
          c.appendChild(
            list<Row>(
              'li',
              () => items(),
              (r) => r.v,
              (r) => r.id,
            ),
          );
        }
        await tick();
        expect(Array.from(c.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['a']);

        items([
          { id: 1, v: 'c' },
          { id: 1, v: 'd' },
        ]);
        await tick();
        expect(Array.from(c.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['c']);
      } finally {
        warn.mockRestore();
      }
    });
  }

  it('eachSSR emits one row per unique key, first occurrence wins', () => {
    const warn = warnSpy();
    try {
      const out = eachSSR(
        [
          { id: 1, v: 'a' },
          { id: 1, v: 'b' },
          { id: 2, v: 'c' },
        ],
        (item) => item().v,
        (item) => item.id,
      );
      expect(out.__purity_ssr_html__).toBe(
        '<!--e--><!--er:1-->a<!--/er--><!--er:2-->c<!--/er--><!--/e-->',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('listSSR emits one row per unique key, first occurrence wins', () => {
    const warn = warnSpy();
    try {
      const out = listSSR(
        'li',
        [
          { id: 1, v: 'a' },
          { id: 1, v: 'b' },
          { id: 2, v: 'c' },
        ],
        (r: Row) => r.v,
        (r: Row) => r.id,
      );
      expect(out.__purity_ssr_html__).toBe('<!--l--><li>a</li><li>c</li><!--/l-->');
    } finally {
      warn.mockRestore();
    }
  });

  it('hydration leaves no stale DOM for duplicate SSR rows', async () => {
    const warn = warnSpy();
    try {
      const host = document.createElement('ul');
      host.innerHTML =
        '<!--e--><!--er:1--><li><!--[-->stale<!--]--></li><!--/er-->' +
        '<!--er:1--><li><!--[-->1<!--]--></li><!--/er--><!--er:2--><li><!--[-->2<!--]--></li><!--/er--><!--/e-->';
      document.body.appendChild(host);
      const closeMarker = document.createComment('slot-close');
      host.appendChild(closeMarker);
      const context = new ComponentContext();
      const deferred: DeferredEach<number> = {
        __purity_deferred_each__: true,
        listAccessor: [1, 2],
        mapFn: (item) => html`<li>${item()}</li>`,
        keyFn: (item) => item,
        options: {},
      };
      pushContext(context);
      try {
        inflateDeferredEach(deferred, Array.from(host.childNodes).slice(0, -1), closeMarker);
      } finally {
        popContext();
      }
      await tick();
      expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
        '1',
        '2',
      ]);
      for (const dispose of context.disposers ?? []) dispose();
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('duplicate keys — review follow-ups (hydration, virtual, listSSR, diagnostics)', () => {
  type Row = { id: number; v: string };
  const warnSpy = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('hydration adopts an SSR row at most once when distinct keys share a string form', async () => {
    const warn = warnSpy();
    try {
      const host = document.createElement('ul');
      host.innerHTML = '<!--e--><!--er:1--><li><!--[-->num<!--]--></li><!--/er--><!--/e-->';
      document.body.appendChild(host);
      const closeMarker = document.createComment('slot-close');
      host.appendChild(closeMarker);
      const context = new ComponentContext();
      const items = [
        { k: 1, t: 'num' },
        { k: '1', t: 'str' },
      ];
      const deferred: DeferredEach<{ k: unknown; t: string }> = {
        __purity_deferred_each__: true,
        listAccessor: items,
        mapFn: (item) => html`<li>${() => item().t}</li>`,
        keyFn: (item) => item.k,
        options: {},
      };
      pushContext(context);
      try {
        inflateDeferredEach(deferred, Array.from(host.childNodes).slice(0, -1), closeMarker);
      } finally {
        popContext();
      }
      await tick();
      expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
        'num',
        'str',
      ]);
      for (const dispose of context.disposers ?? []) dispose();
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it('virtual each() never renders a later duplicate whose first occurrence is offscreen', async () => {
    const warn = warnSpy();
    try {
      // Index 70 duplicates key 10, whose first occurrence (index 10) is far
      // above the viewport. Scrolling to row 50 brings index 70 into the
      // window; it must not render (the first occurrence owns the key).
      const items: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: i, v: String(i) }));
      items[70] = { id: 10, v: '70' };
      const container = document.createElement('div');
      container.style.cssText = 'height:96px;overflow-y:auto';
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 96 });
      container.getBoundingClientRect = () => new DOMRect(0, 0, 200, 96);
      const fragment = each(
        items,
        (item: () => Row) => {
          const row = document.createElement('div');
          row.textContent = item().v;
          return row;
        },
        (item: Row) => item.id,
        { virtual: true },
      );
      document.body.appendChild(container);
      container.appendChild(fragment);
      await tick();
      await tick();
      const topSpacer = container.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
      topSpacer.getBoundingClientRect = () => new DOMRect(0, -container.scrollTop, 200, 0);
      container.scrollTop = 32 * 66; // EACH_WINDOW_ESTIMATED_ROW_HEIGHT rows
      container.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 80));

      const rowTexts = Array.from(container.children)
        .filter((el) => !el.hasAttribute('data-purity-window-spacer'))
        .map((el) => el.textContent);
      // Key 10 is only in the window through the later duplicate, so it must
      // not appear; the unique sequence continues with the original 71.
      expect(rowTexts).toContain('66');
      expect(rowTexts).toContain('71');
      expect(rowTexts).not.toContain('10');
      expect(rowTexts).not.toContain('70');
      container.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it('listSSR uses the options key (not the 4th argument) when an options object is passed, like list()', () => {
    const warn = warnSpy();
    try {
      const out = listSSR(
        'li',
        [
          { id: 1, k: 'x', v: 'a' },
          { id: 2, k: 'x', v: 'b' },
        ],
        { text: (r: Row) => r.v, key: (r: Row) => r.id },
        (r: { k: string }) => r.k,
      );
      expect(out.__purity_ssr_html__).toBe('<!--l--><li>a</li><li>b</li><!--/l-->');
    } finally {
      warn.mockRestore();
    }
  });

  it('a duplicate key that is not String()-convertible warns without aborting the render', () => {
    const warn = warnSpy();
    try {
      const key = Object.create(null) as object;
      const items = state<object[]>([key, key]);
      const c = document.createElement('ul');
      expect(() =>
        c.appendChild(
          each(
            () => items(),
            () => document.createElement('li'),
          ),
        ),
      ).not.toThrow();
      expect(c.querySelectorAll('li')).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('each() — index-sensitive keys with a dropped duplicate', () => {
  it('virtual each() passes original indices to keyFn and mapFn, matching non-virtual each()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const values = ['a', 'a', 'b', 'c'];
      // Keys depend on the index: positions 0 and 1 share key 'x', so the
      // second 'a' is dropped. 'b' and 'c' must keep their original indices.
      const keyFn = (_item: string, i: number) => (i < 2 ? 'x' : `k${i}`);
      const mapFn = (item: () => string, index: number) => {
        const li = document.createElement('li');
        li.textContent = `${item()}@${index}`;
        return li;
      };
      const expected = ['a@0', 'b@2', 'c@3'];

      const plain = each(values, mapFn, keyFn);
      const virtual = each(values, mapFn, keyFn, { virtual: true });

      expect(Array.from(plain.querySelectorAll('li')).map((li) => li.textContent)).toEqual(
        expected,
      );
      expect(Array.from(virtual.querySelectorAll('li')).map((li) => li.textContent)).toEqual(
        expected,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
