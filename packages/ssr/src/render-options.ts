import type { RenderToStringOptions } from './render-to-string.ts';

// Read supported fields explicitly: prototype defaults and non-enumerable
// getters are valid structural options too. Each value is captured once.
export function snapshotRenderOptions(
  options: RenderToStringOptions,
  mode: 'buffered' | 'stream' | 'static' = 'buffered',
): RenderToStringOptions {
  const snapshot: RenderToStringOptions = {
    timeout: options.timeout,
    serializeResources: options.serializeResources,
    nonce: options.nonce,
    signal: options.signal,
  };
  // Streaming does not support buffered metadata flags. Static rendering
  // supplies its own doctype, request, and extractHead, so their nested
  // accessors must not run either.
  if (mode !== 'static') {
    snapshot.doctype = options.doctype;
    snapshot.request = options.request;
  }
  if (mode !== 'stream') snapshot.extractResponse = options.extractResponse;
  if (mode === 'buffered') snapshot.extractHead = options.extractHead;
  return snapshot;
}

// Render options are configuration, but must not become a raw markup escape
// hatch when applications forward external values. Validate before user code
// runs or cancellation listeners are installed.
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
const DOCTYPE_PATTERN = /^<!doctype\s[^<>]*>$/i;

export function validateRenderOptions(
  options: { nonce?: string; doctype?: string },
  renderer: string,
): void {
  if (
    options.nonce !== undefined &&
    (typeof options.nonce !== 'string' || !NONCE_PATTERN.test(options.nonce))
  ) {
    throw new Error(
      `[Purity] ${renderer}: invalid CSP nonce. Must be a string matching ` +
        `${NONCE_PATTERN.source} (base64 / URL-safe characters).`,
    );
  }
  const prefix = options.doctype;
  if (
    prefix !== undefined &&
    (typeof prefix !== 'string' || (prefix !== '' && !DOCTYPE_PATTERN.test(prefix)))
  ) {
    throw new Error(
      `[Purity] ${renderer}: invalid doctype option. ` +
        'Must be an empty string or a single <!DOCTYPE …> declaration with no embedded markup.',
    );
  }
}
