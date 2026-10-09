import { describe, expect, it } from 'vite-plus/test';
import {
  buildResourceScript,
  escapeResourceJson,
  RESOURCE_SCRIPT_ID,
  serializeResourceScriptPayload,
} from '../src/resource-script.ts';

// Direct unit coverage for the escape contract, per the module's own doc
// comment: "Exported separately so tests can assert on the escape contract
// directly without spinning up a full render." resources.test.ts already
// covers the `</script>` case end-to-end through a real renderToString call;
// these pin the full character-by-character contract in isolation, since
// this is injection-prevention code and deserves direct, not just
// incidental, coverage.
describe('escapeResourceJson — injection-prevention contract', () => {
  it('escapes "<" and ">" so a closing script tag cannot be smuggled in', () => {
    const out = escapeResourceJson('</script><script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('escapes "&" so an HTML entity cannot be reconstructed from adjacent text', () => {
    const out = escapeResourceJson('a&b');
    expect(out).toContain('\\u0026');
    expect(out).not.toContain('&');
  });

  it('escapes U+2028/U+2029, which are valid in JSON but illegal in script source', () => {
    const out = escapeResourceJson('line\u2028sep\u2029para');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
  });

  it('round-trips a payload with no dangerous characters unchanged (besides JSON quoting)', () => {
    expect(escapeResourceJson({ a: 1, b: 'plain' })).toBe(JSON.stringify({ a: 1, b: 'plain' }));
  });

  it('escapes dangerous characters nested arbitrarily deep in the payload', () => {
    const out = escapeResourceJson({ nested: { list: ['</script>', 'a&b\u2028c'] } });
    expect(out).not.toMatch(/[<>&\u2028\u2029]/);
  });
});

describe('serializeResourceScriptPayload', () => {
  it('wraps the escaped JSON in a script tag with the given id', () => {
    const out = serializeResourceScriptPayload({ a: 1 }, 'my-id');
    expect(out).toBe('<script type="application/json" id="my-id">{"a":1}</script>');
  });

  it('defaults the id to RESOURCE_SCRIPT_ID', () => {
    const out = serializeResourceScriptPayload({ a: 1 });
    expect(out).toContain(`id="${RESOURCE_SCRIPT_ID}"`);
  });

  it('includes a nonce attribute only when one is supplied', () => {
    expect(serializeResourceScriptPayload({}, 'id', 'abc123')).toContain(' nonce="abc123"');
    expect(serializeResourceScriptPayload({}, 'id')).not.toContain('nonce');
  });
});

describe('buildResourceScript', () => {
  it('returns an empty string when there are no ordered or keyed resources', () => {
    expect(buildResourceScript([], {}, undefined)).toBe('');
  });

  it('emits the legacy bare-array shape when no resource is keyed', () => {
    const out = buildResourceScript([1, 2, 3], {}, undefined);
    expect(out).toContain(JSON.stringify([1, 2, 3]));
  });

  it('emits the { ordered, keyed } shape once at least one resource is keyed', () => {
    const out = buildResourceScript([1], { a: 2 }, undefined);
    expect(out).toContain(JSON.stringify({ ordered: [1], keyed: { a: 2 } }));
  });

  it('still emits the keyed shape when ordered is empty but keyed is not', () => {
    const out = buildResourceScript([], { a: 1 }, undefined);
    expect(out).toContain(JSON.stringify({ ordered: [], keyed: { a: 1 } }));
  });
});
