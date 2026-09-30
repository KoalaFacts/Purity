import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { enhanceForms, mount, query } from '../src/index.ts';
import type { EnhancedForms } from '../src/enhance-forms.ts';
import { _resetQueryCache } from '../src/query.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  _resetQueryCache();
  vi.restoreAllMocks();
});

function cached(key: string | readonly unknown[]) {
  let reads = 0;
  const fetcher = vi.fn(() => Promise.resolve(++reads));
  const value = query({
    key,
    fetcher,
    staleTime: 60_000,
    revalidateOnVisible: false,
    revalidateOnReconnect: false,
    revalidateOnBfcacheRestore: false,
  });
  return { value, fetcher };
}

function fixture(marked = true) {
  const root = document.createElement('div');
  root.innerHTML = `<form action="/save" method="post" ${marked ? 'data-purity-enhance' : ''}>
    <label for="name">Name</label><input id="name" name="name" value="Ada" aria-describedby="help">
    <p id="help">Name help</p><button name="intent" value="save">Save</button>
    <button type="submit" disabled>Locked</button><p data-purity-form-status role="status"></p>
  </form>`;
  document.body.append(root);
  return {
    root,
    form: root.querySelector('form')!,
    field: root.querySelector('input')!,
    button: root.querySelector('button')!,
  };
}

function submit(form: HTMLFormElement, submitter: HTMLElement | null = null) {
  const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter });
  form.dispatchEvent(event);
  return event;
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(() => promise);
  return { resolve, fetch };
}

async function finished(controller: EnhancedForms, form: HTMLFormElement) {
  await vi.waitFor(() => expect(controller.getState(form)().status).not.toBe('pending'));
}

describe('enhanceForms', () => {
  it('refreshes declared query keys exactly once after success, preserving unrelated entries', async () => {
    const { root, form } = fixture();
    const list = cached(['records']);
    const detail = cached(['record', 42]);
    const literal = cached('["records"]');
    const other = cached('other');
    await vi.waitFor(() => expect(list.value()).toBe(1));
    const refresh = vi.spyOn(list.value, 'refresh');
    const controller = enhanceForms(root, {
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          message: 'Saved',
          invalidate: [['records'], ['records'], ['record', 42], '["records"]', 'absent'],
        }),
      ),
    });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    await vi.waitFor(() => expect(list.value()).toBe(2));
    expect(detail.value()).toBe(2);
    expect(literal.value()).toBe(2);
    expect(other.value()).toBe(1);
    expect(list.fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(controller.getState(form)().status).toBe('success');
  });

  it.each([
    { status: 422, body: { fieldErrors: { name: 'Invalid' }, invalidate: ['records'] } },
    { status: 500, body: { message: 'Failed', invalidate: ['records'] } },
    { status: 200, body: { fieldErrors: { name: 'Invalid' }, invalidate: ['records'] } },
  ])('does not invalidate on rejected submission: $status', async ({ status, body }) => {
    const { root, form } = fixture();
    const entry = cached('records');
    await vi.waitFor(() => expect(entry.value()).toBe(1));
    const controller = enhanceForms(root, {
      fetch: vi.fn().mockResolvedValue(Response.json(body, { status })),
    });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    expect(entry.fetcher).toHaveBeenCalledTimes(1);
    expect(controller.getState(form)().status).toBe('error');
  });

  it.each([null, 'records', [null, {}, 123, 'records']])(
    'ignores malformed invalidation metadata without failing the successful write',
    async (invalidate) => {
      const { root, form } = fixture();
      const entry = cached('records');
      await vi.waitFor(() => expect(entry.value()).toBe(1));
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const controller = enhanceForms(root, {
        fetch: vi.fn().mockResolvedValue(Response.json({ message: 'Saved', invalidate })),
      });
      cleanups.push(controller.dispose);
      submit(form);
      await finished(controller, form);
      expect(controller.getState(form)().status).toBe('success');
      expect(log).toHaveBeenCalled();
      if (Array.isArray(invalidate)) await vi.waitFor(() => expect(entry.value()).toBe(2));
      else expect(entry.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps submission success separate from asynchronous query read failures', async () => {
    const { root, form } = fixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('Read failed'));
    const value = query({
      key: 'records',
      fetcher,
      revalidateOnVisible: false,
      revalidateOnReconnect: false,
      revalidateOnBfcacheRestore: false,
    });
    await vi.waitFor(() => expect(value()).toBe('old'));
    const controller = enhanceForms(root, {
      fetch: vi
        .fn()
        .mockResolvedValue(Response.json({ message: 'Saved', invalidate: ['records'] })),
    });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    await vi.waitFor(() => expect(value.error()).toEqual(new Error('Read failed')));
    expect(controller.getState(form)().status).toBe('success');
    expect(form.querySelector('[role=status]')?.textContent).toBe('Saved');
    expect(value()).toBe('old');
  });

  it('isolates a synchronous query refresh failure from the write and other queries', async () => {
    const { root, form } = fixture();
    const broken = cached('broken');
    const working = cached('working');
    await vi.waitFor(() => expect(working.value()).toBe(1));
    vi.spyOn(broken.value, 'refresh').mockImplementation(() => {
      throw new Error('Refresh failed');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = enhanceForms(root, {
      fetch: vi.fn().mockResolvedValue(Response.json({ invalidate: ['broken', 'working'] })),
    });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    await vi.waitFor(() => expect(working.value()).toBe(2));
    expect(controller.getState(form)().status).toBe('success');
    expect(log).toHaveBeenCalled();
  });

  it('does not invalidate when a successful response arrives after disposal', async () => {
    const { root, form } = fixture();
    const entry = cached('records');
    await vi.waitFor(() => expect(entry.value()).toBe(1));
    const transport = deferred();
    const controller = enhanceForms(root, { fetch: transport.fetch });
    submit(form);
    controller.dispose();
    transport.resolve(Response.json({ invalidate: ['records'] }));
    await new Promise((done) => setTimeout(done, 0));
    expect(entry.fetcher).toHaveBeenCalledTimes(1);
  });

  it('submits in place, includes the submitter, exposes reactive state, and prevents duplicates', async () => {
    const { root, form, button, field } = fixture();
    const transport = deferred();
    const controller = enhanceForms(root, { fetch: transport.fetch });
    cleanups.push(controller.dispose);
    const read = controller.getState(form);
    expect(read().status).toBe('idle');
    expect(submit(form, button).defaultPrevented).toBe(true);
    expect(read().status).toBe('pending');
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    submit(form);
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    const init = transport.fetch.mock.calls[0][1]!;
    expect(String(init.body)).toBe('name=Ada&intent=save');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.credentials).toBe('same-origin');
    expect(init.redirect).toBe('error');
    transport.resolve(Response.json({ message: 'Saved!' }));
    await finished(controller, form);
    expect(read().status).toBe('success');
    expect(form.querySelector('[role=status]')?.textContent).toBe('Saved!');
    expect(field.value).toBe('Ada');
    expect(button.disabled).toBe(false);
    expect(form.querySelectorAll('button')[1].disabled).toBe(true);
    expect(form.hasAttribute('aria-busy')).toBe(false);
  });

  it('associates safe field messages, focuses the field, and clears errors on retry', async () => {
    const { root, form, field } = fixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { message: 'Fix the name', fieldErrors: { name: '<script>bad</script>' } },
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ message: 'Saved' }));
    const controller = enhanceForms(root, { fetch });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    expect(controller.getState(form)().status).toBe('error');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const ids = field.getAttribute('aria-describedby')!.split(' ');
    expect(ids[0]).toBe('help');
    expect(document.getElementById(ids[1])?.textContent).toBe('<script>bad</script>');
    expect(form.querySelector('script')).toBeNull();
    submit(form);
    await finished(controller, form);
    expect(field.hasAttribute('aria-invalid')).toBe(false);
    expect(field.getAttribute('aria-describedby')).toBe('help');
    expect(form.querySelector('[data-purity-field-error]')).toBeNull();
    expect(field.value).toBe('Ada');
  });

  it('clears SSR errors without losing help and restores original DOM on disposal', async () => {
    const { root, form, field } = fixture();
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', 'help server-error');
    const error = document.createElement('p');
    error.id = 'server-error';
    error.setAttribute('data-purity-field-error', 'name');
    error.textContent = 'SSR validation';
    form.append(error);
    const controller = enhanceForms(root, { fetch: vi.fn().mockResolvedValue(Response.json({})) });
    submit(form);
    await finished(controller, form);
    expect(field.hasAttribute('aria-invalid')).toBe(false);
    expect(field.getAttribute('aria-describedby')).toBe('help');
    expect(error.hidden).toBe(true);
    controller.dispose();
    expect(error.hidden).toBe(false);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('help server-error');
  });

  it.each([
    () => Promise.reject(new TypeError('offline')),
    () => Promise.resolve(new Response('<html>failure</html>', { status: 500 })),
    () => Promise.resolve(Response.json({ fieldErrors: { name: 123 } })),
    () => Promise.resolve(Response.json(null)),
  ])('preserves inputs on network/protocol failure and allows a retry', async (failure) => {
    const { root, form, field, button } = fixture();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(failure)
      .mockResolvedValueOnce(Response.json({ message: 'Retried' }));
    const controller = enhanceForms(root, { fetch });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    expect(form.querySelector('[role=alert]')?.textContent).toMatch(/try again/);
    expect(field.value).toBe('Ada');
    expect(button.disabled).toBe(false);
    submit(form);
    await finished(controller, form);
    expect(controller.getState(form)().status).toBe('success');
  });

  it('aborts on timeout and permits retry', async () => {
    const { root, form } = fixture();
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_done, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('timeout', 'AbortError')),
          );
        }),
    );
    const controller = enhanceForms(root, { fetch, timeoutMs: 5 });
    cleanups.push(controller.dispose);
    submit(form);
    await finished(controller, form);
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(controller.getState(form)().status).toBe('error');
  });

  it.each(['form', 'root', 'dispose'])(
    'aborts on %s removal and ignores a late response',
    async (kind) => {
      const { root, form, button } = fixture();
      const transport = deferred();
      const controller = enhanceForms(root, { fetch: transport.fetch });
      cleanups.push(controller.dispose);
      submit(form);
      if (kind === 'dispose') controller.dispose();
      else if (kind === 'root') root.remove();
      else form.remove();
      await vi.waitFor(() => expect(transport.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true));
      const original = form.textContent;
      transport.resolve(Response.json({ message: 'Stale!' }));
      await new Promise((done) => setTimeout(done, 0));
      expect(form.textContent).toBe(original);
      expect(button.disabled).toBe(false);
      expect(controller.getState(form)().status).toBe('idle');
    },
  );

  it('automatically disposes with the component render scope', async () => {
    const { root, form } = fixture();
    const host = document.createElement('div');
    document.body.append(host);
    const transport = deferred();
    const mounted = mount(() => {
      enhanceForms(root, { fetch: transport.fetch });
      return document.createElement('span');
    }, host);
    submit(form);
    mounted.unmount();
    expect(transport.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    transport.resolve(Response.json({ message: 'Late' }));
    await new Promise((done) => setTimeout(done, 0));
    expect(form.textContent).not.toContain('Late');
  });

  it('supports dynamic multipart forms and submitter overrides', async () => {
    const { root, form, button } = fixture();
    form.remove();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({}));
    const controller = enhanceForms(root, { fetch });
    cleanups.push(controller.dispose);
    root.append(form);
    button.setAttribute('formaction', '/other');
    button.setAttribute('formenctype', 'multipart/form-data');
    submit(form, button);
    await finished(controller, form);
    expect(fetch.mock.calls[0][0]).toBe(new URL('/other', document.baseURI).href);
    const body = fetch.mock.calls[0][1]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('intent')).toBe('save');
  });

  it('handles control names that shadow native form properties', async () => {
    const { root, form } = fixture();
    for (const name of ['action', 'method', 'elements', 'target', 'enctype']) {
      const input = document.createElement('input');
      input.name = name;
      input.value = 'value';
      form.append(input);
    }
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({}));
    const controller = enhanceForms(root, { fetch });
    cleanups.push(controller.dispose);
    expect(submit(form).defaultPrevented).toBe(true);
    await finished(controller, form);
    expect(fetch.mock.calls[0][0]).toBe(new URL('/save', document.baseURI).href);
    expect(String(fetch.mock.calls[0][1]!.body)).toContain('method=value');
  });

  it('respects a base target and existing submit handlers', () => {
    const { root, form } = fixture();
    const base = document.createElement('base');
    base.target = '_blank';
    document.head.append(base);
    cleanups.push(() => base.remove());
    const fetch = vi.fn<typeof globalThis.fetch>();
    const controller = enhanceForms(root, { fetch });
    cleanups.push(controller.dispose);
    expect(submit(form).defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    base.remove();
    form.addEventListener('submit', (event) => event.preventDefault());
    submit(form);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, Infinity, 2_147_483_648])('rejects unsafe timeout %s', (timeoutMs) => {
    expect(() => enhanceForms(document, { timeoutMs })).toThrow(/timeoutMs/);
  });

  it.each(['unmarked', 'get', 'cross-origin', 'target', 'encoding', 'submitter-get'])(
    'keeps native %s submissions',
    (kind) => {
      const { root, form, button } = fixture(kind !== 'unmarked');
      if (kind === 'get') form.method = 'get';
      if (kind === 'cross-origin') form.action = 'https://other.example/save';
      if (kind === 'target') form.target = '_blank';
      if (kind === 'encoding') form.enctype = 'text/plain';
      if (kind === 'submitter-get') button.setAttribute('formmethod', 'get');
      const fetch = vi.fn<typeof globalThis.fetch>();
      const controller = enhanceForms(root, { fetch });
      cleanups.push(controller.dispose);
      expect(submit(form, button).defaultPrevented).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
