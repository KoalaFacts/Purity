import { onDispose } from './component.ts';
import { invalidateQuery, type QueryKey } from './query.ts';
import { state, type StateAccessor } from './signals.ts';

/** JSON response contract shared by an enhanced form and its server action. */
export interface FormActionResult {
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Exact query keys to refresh after a successful submission. Duplicates are coalesced. */
  invalidate?: readonly QueryKey[];
}

export interface EnhancedFormState {
  readonly status: 'idle' | 'pending' | 'success' | 'error';
  readonly message: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
}

export interface EnhanceFormsOptions {
  /** Supply a transport for testing or application-specific request handling. */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  messages?: Partial<{
    pending: string;
    success: string;
    failure: string;
    network: string;
  }>;
}

export interface EnhancedForms {
  /** Reactive, read-only state for a marked form inside this root. */
  getState(form: HTMLFormElement): () => EnhancedFormState;
  /** Abort requests, remove listeners, and restore managed DOM attributes. */
  dispose(): void;
}

type FormRoot = Document | Element | ShadowRoot;
type FieldSnapshot = { invalid: string | null; describedBy: string | null };
type Entry = {
  signal: StateAccessor<EnhancedFormState>;
  request?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  restorePending?: () => void;
  fields: Map<HTMLElement, FieldSnapshot>;
  errors: HTMLElement[];
  nativeErrors: Map<HTMLElement, HTMLElement['hidden']>;
  region?: HTMLElement;
  ownsRegion: boolean;
  regionText?: string;
  regionRole?: string | null;
};

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function resultFrom(value: unknown): FormActionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a form action result');
  }
  const result = value as Record<string, unknown>;
  if (result.message !== undefined && typeof result.message !== 'string') {
    throw new TypeError('Expected a string message');
  }
  if (result.fieldErrors !== undefined) {
    const errors = result.fieldErrors;
    if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
      throw new TypeError('Expected field errors');
    }
    for (const message of Object.values(errors)) {
      if (typeof message !== 'string') throw new TypeError('Expected string field errors');
    }
  }
  return result as FormActionResult;
}

function refreshQueries(keys: unknown): void {
  if (keys === undefined) return;
  if (!Array.isArray(keys)) {
    console.error('[purity] enhanceForms: invalidate must be an array of query keys.');
    return;
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' && !Array.isArray(key)) {
      console.error('[purity] enhanceForms: ignored an invalid query key.');
      continue;
    }
    try {
      // Same namespaces as query(): a literal string and an array key are distinct.
      const identity = typeof key === 'string' ? `s:${key}` : `a:${JSON.stringify(key)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      invalidateQuery(key);
    } catch (error) {
      // The write already succeeded. A refresh failure must not tell the user
      // to repeat it, nor prevent other affected queries from being refreshed.
      console.error('[purity] enhanceForms: query refresh failed:', error);
    }
  }
}

/**
 * Enhance ordinary `<form data-purity-enhance>` elements inside a root.
 * Marked same-origin POST forms submit JSON requests without replacing the page.
 * Unmarked forms and unsupported methods/targets/encodings keep native behavior.
 * Server actions return `{ message?, fieldErrors?, invalidate? }` for `Accept: application/json`
 * and a normal page/303 redirect for native submissions. Never import handlers
 * into client code. This helper registers teardown with the current render scope;
 * outside a scope, call the returned `dispose()` when removing the root.
 */
export function enhanceForms(
  root: FormRoot | undefined = typeof document === 'undefined' ? undefined : document,
  options: EnhanceFormsOptions = {},
): EnhancedForms {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new TypeError('[Purity] enhanceForms(): timeoutMs must be between 0 and 2147483647.');
  }
  if (!root)
    return {
      getState: () => () => ({ status: 'idle', message: '', fieldErrors: {} }),
      dispose: () => {},
    };
  const scope = root;
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
  const view = doc.defaultView;
  const controls = (form: HTMLFormElement): Element[] =>
    Array.from(
      Object.getOwnPropertyDescriptor(view!.HTMLFormElement.prototype, 'elements')!.get!.call(
        form,
      ) as HTMLFormControlsCollection,
    );
  const messages = {
    pending: 'Submitting…',
    success: 'Submitted successfully.',
    failure: 'Please check your submission.',
    network: 'Could not submit. Please try again.',
    ...options.messages,
  };
  const entries = new Map<HTMLFormElement, Entry>();
  // Detached forms can retain readable state without keeping DOM in this Map.
  const signals = new WeakMap<HTMLFormElement, StateAccessor<EnhancedFormState>>();
  let disposed = false;
  let nextErrorId = 0;
  const contains = (form: HTMLFormElement) => form.isConnected && scope.contains(form);

  function signalFor(form: HTMLFormElement) {
    let signal = signals.get(form);
    if (!signal) {
      signal = state<EnhancedFormState>({ status: 'idle', message: '', fieldErrors: {} });
      signals.set(form, signal);
    }
    return signal;
  }

  function clearErrors(entry: Entry): void {
    for (const error of entry.errors) error.remove();
    entry.errors.length = 0;
    const nativeIds = new Set(Array.from(entry.nativeErrors.keys(), (error) => error.id));
    for (const [field, snapshot] of entry.fields) {
      // A previous SSR validation error must not survive a successful retry.
      field.removeAttribute('aria-invalid');
      const ids = snapshot.describedBy
        ?.split(/\s+/)
        .filter((id) => !nativeIds.has(id))
        .join(' ');
      restoreAttribute(field, 'aria-describedby', ids || null);
    }
    for (const error of entry.nativeErrors.keys()) error.hidden = true;
  }

  function release(form: HTMLFormElement, entry: Entry): void {
    entry.request?.abort();
    clearTimeout(entry.timer);
    entry.restorePending?.();
    clearErrors(entry);
    for (const [field, snapshot] of entry.fields) {
      restoreAttribute(field, 'aria-invalid', snapshot.invalid);
      restoreAttribute(field, 'aria-describedby', snapshot.describedBy);
    }
    for (const [error, hidden] of entry.nativeErrors) error.hidden = hidden;
    if (entry.ownsRegion) entry.region?.remove();
    else if (entry.region) {
      entry.region.textContent = entry.regionText ?? '';
      restoreAttribute(entry.region, 'role', entry.regionRole ?? null);
    }
    if (entry.signal().status === 'pending') {
      entry.signal({ status: 'idle', message: '', fieldErrors: {} });
    }
    entries.delete(form);
  }

  function entryFor(form: HTMLFormElement): Entry {
    let entry = entries.get(form);
    if (entry) return entry;
    entry = {
      signal: signalFor(form),
      fields: new Map(),
      errors: [],
      nativeErrors: new Map(),
      ownsRegion: false,
    };
    for (const error of form.querySelectorAll<HTMLElement>('[data-purity-field-error]')) {
      entry.nativeErrors.set(error, error.hidden);
    }
    for (const field of controls(form)) {
      if (field.getAttribute('aria-invalid') === 'true') {
        entry.fields.set(field as HTMLElement, {
          invalid: field.getAttribute('aria-invalid'),
          describedBy: field.getAttribute('aria-describedby'),
        });
      }
    }
    entry.region = form.querySelector<HTMLElement>('[data-purity-form-status]') ?? undefined;
    if (entry.region) {
      entry.regionText = entry.region.textContent ?? '';
      entry.regionRole = entry.region.getAttribute('role');
    } else {
      entry.region = doc.createElement('p');
      entry.region.setAttribute('data-purity-form-status', '');
      form.append(entry.region);
      entry.ownsRegion = true;
    }
    entries.set(form, entry);
    return entry;
  }

  function showResult(form: HTMLFormElement, entry: Entry, result: FormActionResult, ok: boolean) {
    const fieldErrors = result.fieldErrors ?? {};
    const hasErrors = Object.values(fieldErrors).some(Boolean);
    const success = ok && !hasErrors;
    const message = result.message || (success ? messages.success : messages.failure);
    let firstField: HTMLElement | undefined;
    for (const [name, text] of Object.entries(fieldErrors)) {
      if (!text) continue;
      const matches = controls(form).filter((field) => field.getAttribute('name') === name);
      if (!matches.length) continue;
      const error = doc.createElement('p');
      do {
        error.id = `purity-form-error-${++nextErrorId}`;
      } while (doc.getElementById(error.id));
      error.textContent = text;
      error.setAttribute('data-purity-field-error', name);
      const last = matches[matches.length - 1];
      // Associated controls may live outside this form; keep the error in the form.
      if (form.contains(last)) last.after(error);
      else form.append(error);
      entry.errors.push(error);
      for (const control of matches) {
        const field = control as HTMLElement;
        if (!entry.fields.has(field))
          entry.fields.set(field, {
            invalid: field.getAttribute('aria-invalid'),
            describedBy: field.getAttribute('aria-describedby'),
          });
        const base = field.getAttribute('aria-describedby');
        field.setAttribute('aria-describedby', base ? `${base} ${error.id}` : error.id);
        field.setAttribute('aria-invalid', 'true');
        if (!firstField && !field.matches(':disabled') && field.getAttribute('type') !== 'hidden') {
          firstField = field;
        }
      }
    }
    entry.signal({ status: success ? 'success' : 'error', message, fieldErrors });
    entry.region!.setAttribute('role', success ? 'status' : 'alert');
    entry.region!.textContent = message;
    if (firstField) firstField.focus();
    if (success) refreshQueries(result.invalidate);
  }

  async function submit(event: Event): Promise<void> {
    if (disposed || event.defaultPrevented) return;
    const form = event.target as HTMLFormElement | null;
    if (form?.tagName !== 'FORM' || !form.hasAttribute('data-purity-enhance') || !contains(form))
      return;
    const submitter = (event as SubmitEvent).submitter as
      | HTMLButtonElement
      | HTMLInputElement
      | null;
    // Named controls shadow form.action/method/elements. Read attributes and the
    // native collection getter so common field names cannot break enhancement.
    const method = (
      submitter?.getAttribute('formmethod') ??
      form.getAttribute('method') ??
      'get'
    ).toLowerCase();
    const target =
      submitter?.getAttribute('formtarget') ??
      form.getAttribute('target') ??
      doc.querySelector('base[target]')?.getAttribute('target') ??
      '';
    const encoding =
      submitter?.getAttribute('formenctype') ??
      form.getAttribute('enctype') ??
      'application/x-www-form-urlencoded';
    let action: URL;
    let data: FormData;
    try {
      const url = submitter?.getAttribute('formaction') ?? form.getAttribute('action');
      action = new URL(url || doc.URL, doc.baseURI);
      data = new view!.FormData(form, submitter);
    } catch {
      // An unsupported submitter/URL keeps the browser's own submission behavior.
      return;
    }
    if (
      method !== 'post' ||
      (target && target !== '_self') ||
      action.origin !== view?.location.origin ||
      (encoding !== 'multipart/form-data' && encoding !== 'application/x-www-form-urlencoded')
    )
      return;
    event.preventDefault();
    const entry = entryFor(form);
    if (entry.request) return;
    const body =
      encoding === 'multipart/form-data'
        ? data
        : new URLSearchParams(
            Array.from(data.entries(), ([key, value]) => [
              key,
              typeof value === 'string' ? value : value.name,
            ]),
          );
    clearErrors(entry);
    const request = new AbortController();
    entry.request = request;
    const busy = form.getAttribute('aria-busy');
    const pending = form.getAttribute('data-purity-pending');
    const buttons = controls(form).filter(
      (field) =>
        (field.tagName === 'BUTTON' || field.tagName === 'INPUT') &&
        ((field as HTMLInputElement).type === 'submit' ||
          (field as HTMLInputElement).type === 'image'),
    ) as Array<HTMLButtonElement | HTMLInputElement>;
    const disabled = buttons.map((button) => button.disabled);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    form.setAttribute('aria-busy', 'true');
    form.setAttribute('data-purity-pending', '');
    entry.restorePending = () => {
      restoreAttribute(form, 'aria-busy', busy);
      restoreAttribute(form, 'data-purity-pending', pending);
      buttons.forEach((button, i) => {
        button.disabled = disabled[i];
      });
    };
    entry.signal({ status: 'pending', message: messages.pending, fieldErrors: {} });
    entry.region!.setAttribute('role', 'status');
    entry.region!.textContent = messages.pending;
    entry.timer = setTimeout(() => request.abort(), timeoutMs);
    const current = () =>
      !disposed && entries.get(form) === entry && entry.request === request && contains(form);
    try {
      const response = await (options.fetch ?? globalThis.fetch)(action.href, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        signal: request.signal,
      });
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new TypeError('Expected an application/json response');
      const result = resultFrom(await response.json());
      if (current())
        showResult(
          form,
          entry,
          request.signal.aborted ? { message: messages.network } : result,
          !request.signal.aborted && response.ok,
        );
    } catch {
      // Removal/disposal already cancels and releases this entry. Never write stale DOM.
      if (current()) showResult(form, entry, { message: messages.network }, false);
    } finally {
      if (entries.get(form) === entry && entry.request === request) {
        clearTimeout(entry.timer);
        entry.restorePending?.();
        entry.restorePending = undefined;
        entry.request = undefined;
      }
    }
  }

  const listener = (event: Event) => {
    void submit(event);
  };
  root.addEventListener('submit', listener);
  const observer = view
    ? new view.MutationObserver(() => {
        if (scope !== doc && !scope.isConnected) {
          dispose();
          return;
        }
        for (const [form, entry] of entries) if (!contains(form)) release(form, entry);
      })
    : undefined;
  // Observe the document as well so removing the entire root cancels its requests.
  observer?.observe(doc, { childList: true, subtree: true });
  if (root !== doc) observer?.observe(root, { childList: true, subtree: true });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scope.removeEventListener('submit', listener);
    observer?.disconnect();
    for (const [form, entry] of entries) release(form, entry);
  }
  onDispose(dispose);
  return { getState: (form) => () => signalFor(form)(), dispose };
}
