import type { RenderToStringOptions } from './render-to-string.ts';

// Read supported fields explicitly: prototype defaults and non-enumerable
// getters are valid structural options too. Each value is captured once.
export function snapshotRenderOptions(options: RenderToStringOptions): RenderToStringOptions {
  return {
    timeout: options.timeout,
    serializeResources: options.serializeResources,
    doctype: options.doctype,
    nonce: options.nonce,
    extractHead: options.extractHead,
    extractResponse: options.extractResponse,
    request: options.request,
    signal: options.signal,
  };
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
  if (options.nonce !== undefined && !NONCE_PATTERN.test(options.nonce)) {
    throw new Error(
      `[Purity] ${renderer}: invalid CSP nonce. Must match ` +
        `${NONCE_PATTERN.source} (base64 / URL-safe characters).`,
    );
  }
  const prefix = options.doctype ?? '';
  if (prefix !== '' && !DOCTYPE_PATTERN.test(prefix)) {
    throw new Error(
      `[Purity] ${renderer}: invalid doctype option. ` +
        'Must be a single <!DOCTYPE …> declaration with no embedded markup.',
    );
  }
}
