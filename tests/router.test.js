import { beforeEach, describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { link, route, router } from '../src/router.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('router()', () => {
  beforeEach(() => {
    // Reset to root
    history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  it('returns current path', async () => {
    const { path } = router();
    await tick();
    expect(path()).toBe('/');
  });

  it('push updates path', async () => {
    const { path, push } = router();
    push('/about');
    await tick();
    expect(path()).toBe('/about');
  });

  it('replace updates path without adding history', async () => {
    const { path, replace } = router();
    replace('/login');
    await tick();
    expect(path()).toBe('/login');
  });

  it('reads query params', async () => {
    const { query, push } = router();
    push('/search?q=hello&page=2');
    await tick();
    expect(query().get('q')).toBe('hello');
    expect(query().get('page')).toBe('2');
  });

  it('reads hash', async () => {
    const { hash, push } = router();
    push('/page#section');
    await tick();
    expect(hash()).toBe('#section');
  });
});

describe('route()', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  it('renders matching route', async () => {
    const { push } = router();
    const container = document.createElement('div');
    container.appendChild(
      route({
        '/': () => html`<p class="home">Home</p>`,
        '/about': () => html`<p class="about">About</p>`,
      }),
    );

    await tick();
    expect(container.querySelector('.home')).not.toBeNull();
    expect(container.querySelector('.about')).toBeNull();

    push('/about');
    await tick();
    expect(container.querySelector('.home')).toBeNull();
    expect(container.querySelector('.about')).not.toBeNull();
  });

  it('matches parameterized routes', async () => {
    const { push } = router();
    const container = document.createElement('div');
    container.appendChild(
      route({
        '/user/:id': ({ id }) => html`<p class="user">${id}</p>`,
      }),
    );

    push('/user/42');
    await tick();
    const el = container.querySelector('.user');
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('42');
  });

  it('matches wildcard route', async () => {
    const { push } = router();
    const container = document.createElement('div');
    container.appendChild(
      route({
        '/': () => html`<p class="home">Home</p>`,
        '*': () => html`<p class="notfound">404</p>`,
      }),
    );

    push('/nonexistent');
    await tick();
    expect(container.querySelector('.notfound')).not.toBeNull();
  });

  it('swaps content on navigation', async () => {
    const { push } = router();
    const container = document.createElement('div');
    container.appendChild(
      route({
        '/a': () => html`<p class="a">A</p>`,
        '/b': () => html`<p class="b">B</p>`,
      }),
    );

    push('/a');
    await tick();
    expect(container.querySelector('.a')).not.toBeNull();

    push('/b');
    await tick();
    expect(container.querySelector('.a')).toBeNull();
    expect(container.querySelector('.b')).not.toBeNull();
  });

  it('passes multiple params', async () => {
    const { push } = router();
    const container = document.createElement('div');
    container.appendChild(
      route({
        '/org/:org/repo/:repo': ({ org, repo }) => html`<p class="r">${org}/${repo}</p>`,
      }),
    );

    push('/org/acme/repo/widgets');
    await tick();
    expect(container.querySelector('.r').textContent).toBe('acme/widgets');
  });
});

describe('link()', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });

  it('navigates on click', async () => {
    const { path } = router();
    const container = document.createElement('div');
    container.appendChild(html`<a @click=${link('/about')}>About</a>`);

    const anchor = container.querySelector('a');
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await tick();
    expect(path()).toBe('/about');
  });

  it('prevents default', () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link('/test')(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
