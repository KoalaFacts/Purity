import { describe, it, expect } from 'vitest';
import { state } from '../src/signals.js';
import { show, each } from '../src/helpers.js';

describe('show', () => {
  it('renders view when condition is true', async () => {
    const visible = state(true);
    const fragment = show(
      () => visible(),
      () => {
        const el = document.createElement('p');
        el.textContent = 'visible';
        el.className = 'show-target';
        return el;
      }
    );

    const container = document.createElement('div');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.show-target')).not.toBeNull();
    expect(container.querySelector('.show-target').textContent).toBe('visible');
  });

  it('renders nothing when condition is false', async () => {
    const visible = state(false);
    const fragment = show(
      () => visible(),
      () => {
        const el = document.createElement('p');
        el.className = 'show-target';
        return el;
      }
    );

    const container = document.createElement('div');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.show-target')).toBeNull();
  });

  it('toggles content when condition changes', async () => {
    const visible = state(true);
    const fragment = show(
      () => visible(),
      () => {
        const el = document.createElement('p');
        el.className = 'show-target';
        el.textContent = 'yes';
        return el;
      }
    );

    const container = document.createElement('div');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.show-target')).not.toBeNull();

    visible(false);
    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.show-target')).toBeNull();

    visible(true);
    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.show-target')).not.toBeNull();
  });

  it('renders else content when condition is false', async () => {
    const ok = state(false);
    const fragment = show(
      () => ok(),
      () => {
        const el = document.createElement('p');
        el.className = 'yes';
        return el;
      },
      () => {
        const el = document.createElement('p');
        el.className = 'no';
        return el;
      }
    );

    const container = document.createElement('div');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelector('.yes')).toBeNull();
    expect(container.querySelector('.no')).not.toBeNull();
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
      }
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
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
      }
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelectorAll('li').length).toBe(2);

    items(['A', 'B', 'C', 'D']);
    await new Promise((r) => queueMicrotask(r));
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
      }
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelectorAll('li').length).toBe(3);

    items(['A']);
    await new Promise((r) => queueMicrotask(r));
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
      }
    );

    const container = document.createElement('ul');
    container.appendChild(fragment);

    await new Promise((r) => queueMicrotask(r));
    expect(container.querySelectorAll('li').length).toBe(0);
  });
});
