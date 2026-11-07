import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { state, watch } from '@purityjs/signals';
import { asyncCompute, PendingError } from '../src/async.ts';
import { errorBoundary } from '../src/boundary.ts';
import { loading } from '../src/loading.ts';
import { mount, onDispose, onError, onMount } from '../src/component.ts';
import { html } from '../src/compiler/compile.ts';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
};
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function text(value: () => string): Text {
  const node = document.createTextNode('');
  watch(() => {
    node.data = value();
  });
  return node;
}

function p(...children: Node[]): HTMLElement {
  const node = document.createElement('p');
  for (let i = 0; i < children.length; i++) node.appendChild(children[i]);
  return node;
}

function render(app: () => Node): HTMLElement {
  const host = document.createElement('div');
  unmounts.push(mount(app, host).unmount);
  return host;
}

describe('loading()', () => {
  it('renders the view at once when nothing is pending', () => {
    const host = render(() =>
      p(
        loading(
          () => document.createTextNode('ready'),
          () => document.createTextNode('wait'),
        ),
      ),
    );
    expect(host.textContent).toBe('ready');
  });

  it('shows the fallback on the initial load, then the view once the value settles', async () => {
    const d = deferred<string>();
    const name = asyncCompute(() => d.promise);
    const host = render(() =>
      p(
        loading(
          () => p(text(() => `Hi ${name()}`)),
          () => document.createTextNode('Loading…'),
        ),
      ),
    );
    expect(host.textContent).toBe('Loading…');
    d.resolve('Ada');
    await flush();
    expect(host.textContent).toBe('Hi Ada');
  });

  it('retains the shown view and its edited input across a refetch', async () => {
    const id = state(1);
    const requests: ReturnType<typeof deferred<string>>[] = [];
    const user = asyncCompute(() => {
      id();
      const d = deferred<string>();
      requests.push(d);
      return d.promise;
    });
    let renders = 0;
    const host = render(() =>
      p(
        loading(
          () => {
            renders++;
            return html`<div><span>${() => user()}</span><input /></div>`;
          },
          () => document.createTextNode('Loading…'),
        ),
      ),
    );
    requests[0].resolve('one');
    await flush();
    const input = host.querySelector('input')!;
    input.value = 'edited';
    id(2);
    await flush();
    // Refetch in flight: the complete prior view stays, input and all.
    expect(host.textContent).toBe('one');
    expect(user.pending()).toBe(true);
    expect(host.querySelector('input')).toBe(input);
    requests[1].resolve('two');
    await flush();
    expect(host.textContent).toBe('two');
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('edited');
    expect(renders).toBe(2); // the pending attempt, then the revealed view
  });

  it('releases the pending attempt and the fallback exactly once', async () => {
    const d = deferred<number>();
    const value = asyncCompute(() => d.promise);
    const disposed: string[] = [];
    const mounted: string[] = [];
    const host = render(() =>
      p(
        loading(
          () => {
            onDispose(() => disposed.push('view'));
            onMount(() => mounted.push('view'));
            return p(text(() => String(value())));
          },
          () => {
            onDispose(() => disposed.push('fallback'));
            onMount(() => mounted.push('fallback'));
            return document.createTextNode('…');
          },
        ),
      ),
    );
    await flush();
    expect(disposed).toEqual(['view']);
    expect(mounted).toEqual(['fallback']);
    d.resolve(7);
    await flush();
    expect(host.textContent).toBe('7');
    expect(disposed).toEqual(['view', 'fallback']);
    expect(mounted).toEqual(['fallback', 'view']);
  });

  it('waits through a chain of async values', async () => {
    const a = deferred<number>();
    const b = deferred<number>();
    const first = asyncCompute(() => a.promise);
    const second = asyncCompute(async () => {
      const base = first();
      return base + (await b.promise);
    });
    const host = render(() =>
      p(
        loading(
          () => p(text(() => String(second()))),
          () => document.createTextNode('…'),
        ),
      ),
    );
    a.resolve(1);
    await flush();
    expect(host.textContent).toBe('…');
    b.resolve(2);
    await flush();
    expect(host.textContent).toBe('3');
  });

  it('keeps one fallback while a re-render waits on a second value', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const first = asyncCompute(() => a.promise);
    const second = asyncCompute(() => b.promise);
    let fallbacks = 0;
    const host = render(() =>
      p(
        loading(
          () =>
            p(
              text(() => first()),
              text(() => second()),
            ),
          () => {
            fallbacks++;
            return document.createTextNode('…');
          },
        ),
      ),
    );
    a.resolve('a');
    await flush();
    expect(host.textContent).toBe('…');
    b.resolve('b');
    await flush();
    expect(host.textContent).toBe('ab');
    expect(fallbacks).toBe(1);
  });

  it('passes a rejection to the surrounding errorBoundary', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    const host = render(() =>
      p(
        errorBoundary(
          () =>
            loading(
              () => p(text(() => value())),
              () => document.createTextNode('…'),
            ),
          (error) => document.createTextNode(`failed: ${(error as Error).message}`),
        ),
      ),
    );
    expect(host.textContent).toBe('…');
    d.reject(new Error('offline'));
    await flush();
    expect(host.textContent).toBe('failed: offline');
  });

  it('passes a rejection to the component onError', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    const errors: unknown[] = [];
    const host = render(() => {
      onError((error) => errors.push(error));
      return p(
        loading(
          () => p(text(() => value())),
          () => document.createTextNode('…'),
        ),
      );
    });
    d.reject(new Error('down'));
    await flush();
    expect((errors[0] as Error).message).toBe('down');
    expect(host.textContent).toBe('');
  });

  it('logs a rejection with console.error when no handler takes it', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = render(() =>
      p(
        loading(
          () => p(text(() => value())),
          () => document.createTextNode('…'),
        ),
      ),
    );
    d.reject(new Error('lost'));
    await flush();
    expect(logged).toHaveBeenCalledWith('[Purity] loading() view threw:', expect.any(Error));
    expect(host.textContent).toBe('');
  });

  it('throws a synchronous non-pending render error to the caller', () => {
    expect(() =>
      loading(
        () => {
          throw new Error('boom');
        },
        () => null,
      ),
    ).toThrow('boom');
  });

  it('keeps the fallback for a PendingError with no live source', async () => {
    const host = render(() =>
      p(
        loading(
          () => {
            throw new PendingError();
          },
          () => document.createTextNode('…'),
        ),
      ),
    );
    await flush();
    expect(host.textContent).toBe('…');
  });

  it('stops waiting when its owner is disposed', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    let views = 0;
    const host = document.createElement('div');
    const app = mount(
      () =>
        p(
          loading(
            () => {
              views++;
              return p(text(() => value()));
            },
            () => document.createTextNode('…'),
          ),
        ),
      host,
    );
    app.unmount();
    d.resolve('late');
    await flush();
    expect(views).toBe(1);
    expect(host.textContent).toBe('');
  });

  it('renders nothing when unmounted after settlement but before the queued retry', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    let views = 0;
    const host = document.createElement('div');
    const app = mount(
      () =>
        p(
          loading(
            () => {
              views++;
              return p(text(() => value()));
            },
            () => document.createTextNode('…'),
          ),
        ),
      host,
    );
    // Hold back the retry the settlement queues, unmount, then run it.
    const held: (() => void)[] = [];
    const queue = globalThis.queueMicrotask;
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => {
      if (cb.name === 'retry') held.push(cb);
      else queue(cb);
    });
    d.resolve('late');
    await flush();
    expect(held.length).toBe(1);
    expect(views).toBe(1);
    app.unmount();
    held[0]();
    await flush();
    expect(views).toBe(1);
    expect(host.textContent).toBe('');
  });

  it('works inside a template with sibling bindings that keep updating', async () => {
    const d = deferred<string>();
    const value = asyncCompute(() => d.promise);
    const count = state(0);
    const host = render(
      () =>
        html`<main>
          <b>${() => count()}</b>
          ${loading(
            () => html`<i>${() => value()}</i>`,
            () => html`<i>wait</i>`,
          )}
        </main>` as unknown as Node,
    );
    expect(host.querySelector('i')!.textContent).toBe('wait');
    count(1);
    await flush();
    expect(host.querySelector('b')!.textContent).toBe('1');
    d.resolve('done');
    await flush();
    expect(host.querySelector('i')!.textContent).toBe('done');
  });
});
