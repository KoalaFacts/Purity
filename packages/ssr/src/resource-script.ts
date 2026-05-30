// ---------------------------------------------------------------------------
// Shared resource-script payload serializer.
//
// Both `renderToString` and `renderToStream` inline resolved resources as
// `<script type="application/json" id="…">…</script>` so the client hydrator
// can prime its cache and skip the first refetch. The JSON has to defang
// sequences that would close the script tag early (`</script>` smuggling)
// and Unicode line separators that JSON allows but ECMAScript source does
// not. Centralising the escape + tag emission here keeps the contract in
// ONE place — if a new escape needs to be added (e.g. `<!--` HTML5 comment
// quirk), both renderers pick it up automatically.
// ---------------------------------------------------------------------------

/** Default `id` for the shell-level resource-cache script. */
export const RESOURCE_SCRIPT_ID = '__purity_resources__';

// U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR are valid in JSON
// strings but illegal in ECMAScript source — embedding a raw one inside an
// inline `<script>` body would break the surrounding script's parse. Built
// via `new RegExp` so this file itself contains no literal line separators
// (oxc rejects them in regex literal source).
const LINE_SEP_RE = new RegExp('\u2028', 'g');
const PARA_SEP_RE = new RegExp('\u2029', 'g');

/**
 * JSON-encode the payload then defang sequences that would close the script
 * tag early or interact badly with the HTML parser. Mirrors the standard
 * SSR-payload escaping used by React, Vue, etc.
 *
 * Exported separately so tests can assert on the escape contract directly
 * without spinning up a full render.
 */
export function escapeResourceJson(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEP_RE, '\\u2028')
    .replace(PARA_SEP_RE, '\\u2029');
}

/**
 * Build the full `<script type="application/json" id="…">…</script>` tag
 * wrapping the JSON-serialized resource payload. Callers are responsible
 * for the validity of `nonce` (it's spliced verbatim into the attribute);
 * both renderers validate it against `[A-Za-z0-9+/=_-]+` before calling.
 *
 * @param payload - Value to JSON-encode and embed.
 * @param id - Script id; defaults to {@link RESOURCE_SCRIPT_ID}.
 * @param nonce - Optional strict-CSP nonce; omitted from the output when undefined.
 */
export function serializeResourceScriptPayload(
  payload: unknown,
  id: string = RESOURCE_SCRIPT_ID,
  nonce?: string,
): string {
  const json = escapeResourceJson(payload);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<script type="application/json" id="${id}"${nonceAttr}>${json}</script>`;
}
