import { beforeEach, describe, expect, it } from 'vitest';
import { link, route, router } from '../src/index.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('router()', () => {
  beforeEach(() => {
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

  it('replace updates path', async () => {
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

describe('link()', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });

  it('navigates on click', async () => {
    const { path } = router();
    link('/about')(new MouseEvent('click', { cancelable: true }));
    await tick();
    expect(path()).toBe('/about');
  });

  it('prevents default', () => {
    const event = new MouseEvent('click', { cancelable: true });
    link('/test')(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
