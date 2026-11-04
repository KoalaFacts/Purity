// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { mount } from '../src/component.ts';
import { each, list, match } from '../src/control.ts';
import { html } from '../src/compiler/compile.ts';
import { component } from '../src/elements.ts';

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

describe('dynamic root ownership', () => {
  it('reorders NaN and signed-zero keys without replacing their rows', async () => {
    const values = state([Number.NaN, -0]);
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        each(values, (item) => {
          const node = document.createElement('span');
          node.textContent = Number.isNaN(item()) ? 'nan' : 'zero';
          return node;
        }) as DocumentFragment,
      host,
    );
    const [nan, zero] = host.querySelectorAll('span');
    values([0, Number.NaN]);
    await tick();
    expect([...host.querySelectorAll('span')]).toEqual([zero, nan]);
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  for (const kind of ['each', 'list', 'match'] as const) {
    it(`unmounts current ${kind} nodes after a root update`, async () => {
      const value = state('a');
      const host = document.createElement('div');
      const render = () => {
        if (kind === 'list')
          return list(
            'span',
            () => [value()],
            (item) => item,
          );
        if (kind === 'each')
          return each(
            () => [value()],
            (item) => {
              const node = document.createElement('span');
              node.textContent = item();
              return node;
            },
          );
        return match(value, {
          a: () => document.createTextNode('a'),
          b: () => document.createTextNode('b'),
        });
      };
      const mounted = mount(render as () => DocumentFragment, host);
      value('b');
      await tick();
      expect(host.textContent).toBe('b');
      const sibling = document.createElement('aside');
      host.appendChild(sibling);
      mounted.unmount();
      expect(host.childNodes.length).toBe(1);
      expect(host.firstChild).toBe(sibling);
    });
  }

  it('removes updated nested list nodes when their matching branch changes', async () => {
    const visible = state(true);
    const value = state('a');
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        match(visible, {
          true: () =>
            each(
              () => [value()],
              (item) => {
                const node = document.createElement('span');
                node.textContent = item();
                return node;
              },
            ),
          false: () => document.createTextNode('done'),
        }) as DocumentFragment,
      host,
    );
    value('b');
    await tick();
    expect(host.textContent).toBe('b');
    visible(false);
    await tick();
    expect(host.textContent).toBe('done');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('unmounts nodes inserted by a root template slot after an update', async () => {
    const showNode = state(false);
    const host = document.createElement('div');
    const node = document.createElement('span');
    node.textContent = 'node';
    const mounted = mount(() => html`${() => (showNode() ? node : 'text')}`, host);
    showNode(true);
    await tick();
    expect(host.textContent).toBe('node');
    const unrelated = document.createElement('aside');
    host.appendChild(unrelated);
    mounted.unmount();
    expect(host.childNodes.length).toBe(1);
    expect(host.firstChild).toBe(unrelated);
  });

  it('unmounts updated root slots returned by a child component factory', async () => {
    const showNode = state(false);
    const node = document.createElement('span');
    node.textContent = 'node';
    const Child = component(
      'p-dynamic-root-slot',
      () => html`${() => (showNode() ? node : 'text')}`,
    );
    const host = document.createElement('div');
    const mounted = mount(() => Child({}), host);
    showNode(true);
    await tick();
    expect(host.textContent).toBe('node');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('removes updated template slot nodes when their matching branch changes', async () => {
    const visible = state(true);
    const showNode = state(false);
    const node = document.createElement('span');
    node.textContent = 'node';
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        match(visible, {
          true: () => html`${() => (showNode() ? node : 'text')}`,
          false: () => document.createTextNode('done'),
        }) as DocumentFragment,
      host,
    );
    showNode(true);
    await tick();
    visible(false);
    await tick();
    expect(host.textContent).toBe('done');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('keeps nested match ownership correct across slot and branch changes', async () => {
    const outer = state(true);
    const inner = state(true);
    const showNode = state(false);
    const node = document.createElement('span');
    node.textContent = 'node';
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        match(outer, {
          true: () =>
            match(inner, {
              true: () => html`${() => (showNode() ? node : 'text')}`,
              false: () => document.createTextNode('inner'),
            }),
          false: () => document.createTextNode('outer'),
        }) as DocumentFragment,
      host,
    );
    showNode(true);
    await tick();
    expect(host.textContent).toBe('node');
    inner(false);
    await tick();
    expect(host.textContent).toBe('inner');
    outer(false);
    await tick();
    expect(host.textContent).toBe('outer');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('reorders list rows whose root template slots have replaced their nodes', async () => {
    const values = state(['a', 'b']);
    const showNode = state(false);
    const host = document.createElement('div');
    const created = new Map<string, HTMLElement>();
    const mounted = mount(
      () =>
        each(values, (item) => {
          const node = document.createElement('span');
          node.textContent = item();
          created.set(item(), node);
          return html`${() => (showNode() ? node : item())}`;
        }) as DocumentFragment,
      host,
    );
    showNode(true);
    await tick();
    expect(host.textContent).toBe('ab');
    values(['b', 'a']);
    await tick();
    expect(host.textContent).toBe('ba');
    expect([...host.querySelectorAll('span')]).toEqual([created.get('b'), created.get('a')]);
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('reorders outer rows after nested root lists change their nodes', async () => {
    const outer = state(['a', 'b']);
    const suffixes = state(['1']);
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        each(
          outer,
          (item) =>
            each(
              () => suffixes(),
              (suffix) => `${item()}${suffix()}`,
            ) as DocumentFragment,
        ) as DocumentFragment,
      host,
    );
    suffixes(['1', '2']);
    await tick();
    expect(host.textContent).toBe('a1a2b1b2');
    outer(['b', 'a']);
    await tick();
    expect(host.textContent).toBe('b1b2a1a2');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('tracks nested root lists that start empty', async () => {
    const outer = state(['a', 'b']);
    const suffixes = state<string[]>([]);
    const host = document.createElement('div');
    const mounted = mount(
      () =>
        each(
          outer,
          (item) => each(suffixes, (suffix) => `${item()}${suffix()}`) as DocumentFragment,
        ) as DocumentFragment,
      host,
    );
    suffixes(['1', '2']);
    await tick();
    outer(['b', 'a']);
    await tick();
    expect(host.textContent).toBe('b1b2a1a2');
    mounted.unmount();
    expect(host.childNodes).toHaveLength(0);
  });
});
