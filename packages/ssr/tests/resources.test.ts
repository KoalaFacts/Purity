import { lazyResource, resource, state, suspense } from '@purityjs/core';
import { describe, expect, it, vi } from 'vite-plus/test';
import {
  html,
  renderToStream,
  renderToStreamResponse,
  renderToString,
  type RenderToStreamOptions,
} from '../src/index.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('SSR resource cancellation', () => {
  const renderers = [
    {
      name: 'buffered',
      render: (view: () => unknown, options: RenderToStreamOptions) =>
        renderToString(view, options),
    },
    {
      name: 'stream',
      render: (view: () => unknown, options: RenderToStreamOptions) =>
        new Response(renderToStream(view, options)).text(),
    },
    {
      name: 'stream response',
      render: async (view: () => unknown, options: RenderToStreamOptions) =>
        new Response((await renderToStreamResponse(view, options)).body).text(),
    },
  ];

  describe.each(renderers)('$name', ({ name, render }) => {
    it.each(['request', 'explicit'] as const)(
      'forwards %s cancellation into the fetcher',
      async (source) => {
        const requestAbort = new AbortController();
        const explicitAbort = new AbortController();
        const request = new Request('https://example.test/', { signal: requestAbort.signal });
        let fetchSignal!: AbortSignal;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const outcome = render(
          () => {
            resource(({ signal }) => {
              fetchSignal = signal;
              markStarted();
              return new Promise(() => {});
            });
            return html`<p>waiting</p>`;
          },
          { request, signal: explicitAbort.signal },
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        // Direct streams begin work on their first automatic pull. Verify
        // cancellation of an active fetcher rather than assuming eager start.
        await started;
        const reason = new Error('connection ended');
        (source === 'request' ? requestAbort : explicitAbort).abort(reason);
        const result = await outcome;
        expect(fetchSignal.aborted).toBe(true);
        expect(fetchSignal.reason).toBe(reason);
        expect(source === 'request' ? explicitAbort.signal.aborted : request.signal.aborted).toBe(
          false,
        );
        if (name === 'stream') expect(result).toEqual({ value: '' });
        else expect(result).toEqual({ error: reason });
      },
    );

    it('cancels unfinished resource work on a global timeout', async () => {
      const request = new Request('https://example.test/');
      let fetchSignal!: AbortSignal;
      await expect(
        render(
          () => {
            resource(({ signal }) => {
              fetchSignal = signal;
              return new Promise(() => {});
            });
            return html`<p>waiting</p>`;
          },
          { request, timeout: 10 },
        ),
      ).rejects.toThrow('timed out');
      expect(fetchSignal.aborted).toBe(true);
      expect(request.signal.aborted).toBe(false);
    });

    it('cancels resource work if the component throws', async () => {
      const reason = new Error('component failure');
      let fetchSignal!: AbortSignal;
      await expect(
        render(() => {
          resource(({ signal }) => {
            fetchSignal = signal;
            return new Promise(() => {});
          });
          throw reason;
        }, {}),
      ).rejects.toBe(reason);
      expect(fetchSignal.aborted).toBe(true);
    });

    it('detaches request and explicit listeners when the render completes', async () => {
      const request = new Request('https://example.test/');
      const controller = new AbortController();
      const sources = [request.signal, controller.signal];
      const listeners = sources.map((signal) => ({
        add: vi.spyOn(signal, 'addEventListener'),
        remove: vi.spyOn(signal, 'removeEventListener'),
      }));
      let fetchSignal!: AbortSignal;
      const output = await render(
        () => {
          const value = resource(({ signal }) => {
            fetchSignal = signal;
            return Promise.resolve('ready');
          });
          return html`<p>${() => value()}</p>`;
        },
        { request, signal: controller.signal },
      );
      expect(output).toContain('ready');
      for (const { add, remove } of listeners) {
        for (const [type, listener] of add.mock.calls) {
          if (type === 'abort') expect(remove).toHaveBeenCalledWith(type, listener);
        }
        add.mockRestore();
        remove.mockRestore();
      }
      controller.abort();
      expect(fetchSignal.aborted).toBe(false);
    });

    it('skips user code for an already aborted Request', async () => {
      const controller = new AbortController();
      controller.abort();
      const view = vi.fn(() => html`<p>unexpected</p>`);
      const outcome = render(view, {
        request: new Request('https://example.test/', { signal: controller.signal }),
      });
      if (name === 'stream') expect(await outcome).toBe('');
      else await expect(outcome).rejects.toBe(controller.signal.reason);
      expect(view).not.toHaveBeenCalled();
    });

    it('keeps settled operations independent with many concurrent resources', async () => {
      let renderSignal!: AbortSignal;
      const signals: AbortSignal[] = [];
      const output = await render(
        () => {
          const values = Array.from({ length: 32 }, (_, index) =>
            resource(
              ({ signal }) => {
                signals.push(signal);
                return Promise.resolve(index);
              },
              { key: `item-${index}` },
            ),
          );
          return html`<p>${() => values.map((value) => value()).join(',')}</p>`;
        },
        { signal: (renderSignal = new AbortController().signal) },
      );
      expect(output).toContain('30,31');
      expect(signals).toHaveLength(32);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      expect(renderSignal.aborted).toBe(false);
    });
  });

  it.each(['resource', 'lazyResource'] as const)(
    'reader.cancel stops deferred %s work and preserves the reason',
    async (kind) => {
      let fetchSignal!: AbortSignal;
      const fetcher = ({ signal }: { signal: AbortSignal }) => {
        fetchSignal = signal;
        return new Promise<string>(() => {});
      };
      const body = renderToStream(
        () =>
          html`<main>${suspense(
            () => {
              if (kind === 'resource') resource(fetcher, { key: 'deferred' });
              else
                lazyResource((_arg: string, info) => fetcher(info), { key: 'deferred' }).fetch(
                  'input',
                );
              return html`<p>loaded</p>`;
            },
            () => html`<p>fallback</p>`,
          )}</main>`,
      );
      const reader = body.getReader();
      expect((await reader.read()).done).toBe(false);
      await vi.waitFor(() => expect(fetchSignal).toBeDefined());
      const reason = new Error('reader left');
      await reader.cancel(reason);
      expect(fetchSignal.aborted).toBe(true);
      expect(fetchSignal.reason).toBe(reason);
    },
  );

  describe.each(['stream', 'stream response'] as const)('deferred %s', (renderer) => {
    it.each(['request', 'explicit'] as const)(
      'forwards %s cancellation after the shell is sent',
      async (source) => {
        const requestAbort = new AbortController();
        const explicitAbort = new AbortController();
        const request = new Request('https://example.test/', { signal: requestAbort.signal });
        let fetchSignal!: AbortSignal;
        const view = () =>
          html`<main>${suspense(
            () => {
              resource(({ signal }) => {
                fetchSignal = signal;
                return new Promise(() => {});
              });
              return html`<p>loaded</p>`;
            },
            () => html`<p>fallback</p>`,
          )}</main>`;
        const options = { request, signal: explicitAbort.signal };
        const body =
          renderer === 'stream'
            ? renderToStream(view, options)
            : (await renderToStreamResponse(view, options)).body;
        const reader = body.getReader();
        const shell = await reader.read();
        expect(new TextDecoder().decode(shell.value)).toContain('fallback');
        await vi.waitFor(() => expect(fetchSignal).toBeDefined());
        const reason = new Error('left after shell');
        (source === 'request' ? requestAbort : explicitAbort).abort(reason);
        expect((await reader.read()).done).toBe(true);
        expect(fetchSignal.reason).toBe(reason);
        expect(fetchSignal.aborted).toBe(true);
      },
    );
  });

  it.each(['buffered', 'stream'] as const)(
    'cancels abandoned boundary work when %s rendering completes',
    async (renderer) => {
      let fetchSignal!: AbortSignal;
      const view = () =>
        html`<main>${suspense(
          () => {
            resource(
              ({ signal }) => {
                fetchSignal = signal;
                return new Promise(() => {});
              },
              { key: 'unfinished' },
            );
            return html`<p>loaded</p>`;
          },
          () => html`<p>fallback</p>`,
          { timeout: 10 },
        )}</main>`;
      const output =
        renderer === 'buffered'
          ? await renderToString(view)
          : await new Response(renderToStream(view, { timeout: 10 })).text();
      expect(output).toContain('fallback');
      expect(output).not.toContain('"unfinished"');
      expect(fetchSignal.aborted).toBe(true);
    },
  );

  it('keeps concurrent renders isolated when they share a Request', async () => {
    const request = new Request('https://example.test/');
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const view = () => {
      const value = resource(({ signal }) => {
        signals.push(signal);
        return pending;
      });
      return html`<p>${() => value()}</p>`;
    };
    const first = renderToString(view, { request, signal: controller.signal }).catch(
      (error) => error,
    );
    const second = renderToString(view, { request });
    const reason = new Error('first ended');
    controller.abort(reason);
    expect(await first).toBe(reason);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(request.signal.aborted).toBe(false);
    release('second ready');
    expect(await second).toContain('second ready');
  });
});

describe('renderToString — resource awaiting', () => {
  it('awaits a single pending resource and renders the resolved value', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('hello'));
      return html`<p>${() => r() ?? '...'}</p>`;
    });
    expect(out).toContain('<!--[-->hello<!--]-->');
  });

  it('embeds resolved resources into a __purity_resources__ script', async () => {
    const out = await renderToString(() => {
      const r1 = resource(() => Promise.resolve('one'));
      const r2 = resource(() => Promise.resolve('two'));
      return html`<p>${() => r1() ?? ''}</p>
        <p>${() => r2() ?? ''}</p>`;
    });
    expect(out).toContain('<script type="application/json" id="__purity_resources__">');
    expect(out).toContain('"one"');
    expect(out).toContain('"two"');
  });

  it('omits the script when serializeResources is false', async () => {
    const out = await renderToString(
      () => {
        const r = resource(() => Promise.resolve('x'));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { serializeResources: false },
    );
    expect(out).not.toContain('__purity_resources__');
  });

  it('handles multiple resources resolving in different orders', async () => {
    let resolveSlow: ((v: string) => void) | null = null;
    const slow = new Promise<string>((r) => {
      resolveSlow = r;
    });
    const out = renderToString(() => {
      const r1 = resource(() => slow);
      const r2 = resource(() => Promise.resolve('fast'));
      return html`<p>${() => r1() ?? ''}-${() => r2() ?? ''}</p>`;
    });
    // Resolve slow last to verify the await waits for ALL pending.
    setTimeout(() => resolveSlow!('slow'), 5);
    const result = await out;
    expect(result).toContain('slow');
    expect(result).toContain('fast');
  });

  it('escapes < / > / & in the script payload to prevent injection', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('</script><script>alert(1)</script>'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('clears the timeout race timer once pending resources settle (no dangling timer)', async () => {
    // The pass that awaits resources races Promise.all against a setTimeout.
    // When the resources win, the timer must be cleared — otherwise a ref'd
    // timer stays armed for the full timeout window after the render is done.
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const before = clearSpy.mock.calls.length;
    const out = await renderToString(
      () => {
        // A resource without pollInterval — its only timer interaction is
        // none, so any clearTimeout we observe comes from the race cleanup.
        const r = resource(() => Promise.resolve('done'));
        return html`<p>${() => r() ?? '...'}</p>`;
      },
      { timeout: 30_000 },
    );
    expect(out).toContain('done');
    // The race ran (one pending resource) and its loser timer was cleared.
    expect(clearSpy.mock.calls.length).toBeGreaterThan(before);
    clearSpy.mockRestore();
  });

  it('times out when a resource never resolves', async () => {
    const promise = renderToString(
      () => {
        const r = resource(() => new Promise<string>(() => {}));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { timeout: 50 },
    );
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it('propagates resource errors via the resource error() accessor', async () => {
    const out = await renderToString(() => {
      const r = resource<string>(() => Promise.reject(new Error('fetch fail')));
      return html`<p>${() => (r.error() ? 'errored' : 'no')}</p>`;
    });
    expect(out).toContain('<!--[-->errored<!--]-->');
  });

  it('handles a sync (non-promise) fetcher', async () => {
    const out = await renderToString(() => {
      const r = resource(() => 'sync-value');
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).toContain('<!--[-->sync-value<!--]-->');
  });

  it('skips the fetcher when source returns null', async () => {
    let fetcherCalls = 0;
    const out = await renderToString(() => {
      const r = resource<string, string>(
        () => null,
        (key) => {
          fetcherCalls++;
          return Promise.resolve(`fetched-${key}`);
        },
      );
      return html`<p>${() => r() ?? 'idle'}</p>`;
    });
    expect(fetcherCalls).toBe(0);
    expect(out).toContain('<!--[-->idle<!--]-->');
  });

  it('uses the source key in the fetcher', async () => {
    const id = state('42');
    const out = await renderToString(() => {
      const r = resource(
        () => id(),
        (key) => Promise.resolve(`user-${key}`),
      );
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).toContain('<!--[-->user-42<!--]-->');
  });
});

describe('client hydration cache priming', () => {
  it('matches resolved values to resource creation order', async () => {
    // Render twice — first to capture the SSR payload, then verify the
    // shape of the embedded data so the client side can map indices back
    // to resource() call order.
    const out = await renderToString(() => {
      const a = resource(() => Promise.resolve('alpha'));
      const b = resource(() => Promise.resolve('beta'));
      const c = resource(() => Promise.resolve('gamma'));
      return html`<p>${() => a() ?? ''}-${() => b() ?? ''}-${() => c() ?? ''}</p>`;
    });
    const match = out.match(
      /<script type="application\/json" id="__purity_resources__">(.+?)<\/script>/,
    );
    expect(match).not.toBeNull();
    // Decode the payload — undo the < > & escapes from buildResourceScript.
    const decoded = match![1]
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&');
    const parsed = JSON.parse(decoded);
    expect(parsed).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles a re-render that produces no new resources', async () => {
    let creates = 0;
    await tick();
    const out = await renderToString(() => {
      creates++;
      const r = resource(() => Promise.resolve('x'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    // Two passes: first triggers the fetch, second consumes the resolved value.
    expect(creates).toBe(2);
    expect(out).toContain('<!--[-->x<!--]-->');
  });
});

describe('renderToString — keyed resources', () => {
  function decodePayload(out: string): unknown {
    const match = out.match(
      /<script type="application\/json" id="__purity_resources__">(.+?)<\/script>/,
    );
    if (!match) return null;
    const decoded = match[1]
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&');
    return JSON.parse(decoded);
  }

  it('emits the legacy array shape when no resource opts into a key', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('plain'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(decodePayload(out)).toEqual(['plain']);
  });

  it('emits { ordered, keyed } when a key is supplied', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('value-by-key'), { key: 'todos' });
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(decodePayload(out)).toEqual({
      ordered: [],
      keyed: { todos: 'value-by-key' },
    });
  });

  it('mixes keyed + unkeyed resources cleanly in the payload', async () => {
    const out = await renderToString(() => {
      const a = resource(() => Promise.resolve('A'));
      const b = resource(() => Promise.resolve('B'), { key: 'b' });
      const c = resource(() => Promise.resolve('C'));
      return html`<p>${() => a() ?? ''}-${() => b() ?? ''}-${() => c() ?? ''}</p>`;
    });
    expect(decodePayload(out)).toEqual({
      ordered: ['A', 'C'],
      keyed: { b: 'B' },
    });
  });

  it('survives conditional resource creation when keys are stable', async () => {
    let conditional = true;
    const App = () => {
      // First pass: both resources created. Second pass: only the keyed
      // one. Without keys the index would shift; with `key`, the keyed
      // resource still resolves to the cached value.
      if (conditional) resource(() => Promise.resolve('cond'));
      const r = resource(() => Promise.resolve('keyed'), { key: 'stable' });
      conditional = false;
      return html`<p>${() => r() ?? ''}</p>`;
    };
    const out = await renderToString(App);
    const payload = decodePayload(out) as { keyed: Record<string, unknown> };
    expect(payload.keyed.stable).toBe('keyed');
  });
});
