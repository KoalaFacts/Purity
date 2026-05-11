import { describe, expect, it } from 'vitest';
import { stripServerActionBodies } from '../src/server-action-strip.ts';
import { purity } from '../src/index.ts';

// Tests for smart `serverAction()` body-only stripping — ADR 0035.
// Complements ADR 0018: where the filename convention strips a whole module,
// this strips just the handler argument of `serverAction(url, handler)` calls
// in client builds, leaving `.url` and `.invoke()` intact for client code.

const STUB_MARKER = '/* @purity stripped */';

describe('stripServerActionBodies — direct helper', () => {
  it('replaces an inline arrow handler in a client build', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async (req) => {`,
      `  await db.insert({ secret: true });`,
      `  return new Response('ok');`,
      `});`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain(STUB_MARKER);
    // Original handler body must be gone.
    expect(result!.code).not.toContain('db.insert');
    expect(result!.code).not.toContain("'ok'");
    // `serverAction` call + url must remain.
    expect(result!.code).toContain('/api/a');
    expect(result!.code).toContain('serverAction');
  });

  it('replaces a block-bodied function expression handler', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async function handler(req) {`,
      `  return new Response(SECRET);`,
      `});`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('SECRET');
    expect(result!.code).toContain(STUB_MARKER);
  });

  it('replaces a single-expression arrow handler (no block body)', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', (req) => doSecretWork(req));`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('doSecretWork');
    expect(result!.code).toContain(STUB_MARKER);
  });

  it('handles an aliased import: `serverAction as sa`', () => {
    const src = [
      `import { serverAction as sa } from '@purityjs/core';`,
      `export const a = sa('/api/a', async (req) => SECRET);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('SECRET');
  });

  it('handles a namespace import: `import * as p from "@purityjs/core"`', () => {
    const src = [
      `import * as p from '@purityjs/core';`,
      `export const a = p.serverAction('/api/a', async (req) => SECRET);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('SECRET');
  });

  it('skips files that do not import from @purityjs/core', () => {
    const src = [
      `function serverAction(url, fn) { return fn; }`,
      `export const a = serverAction('/api/a', async () => SECRET);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    // No import from @purityjs/core → no strip.
    expect(result).toBeNull();
  });

  it('leaves handler-as-identifier references alone (with a warning, not a strip)', () => {
    // We can't safely strip when the handler is a separate binding — it
    // may be reused. Defense-in-depth means: only strip inline handlers.
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `const handler = async (req) => SECRET;`,
      `export const a = serverAction('/api/a', handler);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    // The handler binding stays — user must use the .server.ts convention
    // (ADR 0018) to strip non-inline handlers. But we don't error.
    if (result !== null) {
      expect(result.code).toContain('SECRET');
    }
  });

  it('strips multiple serverAction() calls in one file', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async () => SECRET_A);`,
      `export const b = serverAction('/api/b', async () => SECRET_B);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('SECRET_A');
    expect(result!.code).not.toContain('SECRET_B');
    expect(result!.code).toContain('/api/a');
    expect(result!.code).toContain('/api/b');
  });

  it('preserves source positions of unrelated code', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async () => SECRET);`,
      `export const sentinel = 42;`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('export const sentinel = 42;');
  });

  it('returns null when no serverAction calls are found', () => {
    const src = [
      `import { state } from '@purityjs/core';`,
      `export const counter = state(0);`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/counter.ts');
    expect(result).toBeNull();
  });

  it('handles TypeScript syntax (type annotations on params + return)', () => {
    const src = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async (req: Request): Promise<Response> => {`,
      `  return new Response(SECRET);`,
      `});`,
    ].join('\n');

    const result = stripServerActionBodies(src, '/app/a.ts');
    expect(result).not.toBeNull();
    expect(result!.code).not.toContain('SECRET');
    expect(result!.code).toContain(STUB_MARKER);
  });
});

describe('stripServerActions plugin option — wired into transform', () => {
  it('strips handler bodies in client builds by default', () => {
    const plugin = purity();
    const code = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async (req) => {`,
      `  return new Response(SECRET);`,
      `});`,
    ].join('\n');
    const result = plugin.transform(code, '/app/a.ts', { ssr: false });
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).not.toContain('SECRET');
    expect((result as { code: string }).code).toContain('serverAction');
  });

  it('does NOT strip in SSR builds (handler bodies must run on the server)', () => {
    const plugin = purity();
    const code = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async (req) => {`,
      `  return new Response(SECRET);`,
      `});`,
    ].join('\n');
    // SSR build: pass-through (no html`` either), so transform returns null.
    const result = plugin.transform(code, '/app/a.ts', { ssr: true });
    expect(result).toBeNull();
  });

  it('respects stripServerActions: false (opt-out)', () => {
    const plugin = purity({ stripServerActions: false });
    const code = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async (req) => {`,
      `  return new Response(SECRET);`,
      `});`,
    ].join('\n');
    const result = plugin.transform(code, '/app/a.ts', { ssr: false });
    // No html`` means the rest of the pipeline returns null too.
    if (result !== null) {
      expect((result as { code: string }).code).toContain('SECRET');
    }
  });

  it('still respects the *.server.ts strip when both options are on', () => {
    // ADR 0018 takes precedence: a *.server.ts file is fully stripped, so we
    // never reach the per-call stripping pass.
    const plugin = purity();
    const code = [
      `import { serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async () => SECRET);`,
    ].join('\n');
    const result = plugin.transform(code, '/app/a.server.ts', { ssr: false });
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).toContain('export {};');
    expect((result as { code: string }).code).not.toContain('SECRET');
  });

  it('composes with html`` AOT compilation in non-server files', () => {
    const plugin = purity();
    const code = [
      `import { html, serverAction } from '@purityjs/core';`,
      `export const a = serverAction('/api/a', async () => SECRET);`,
      `export const view = () => html\`<p>hi</p>\`;`,
    ].join('\n');
    const result = plugin.transform(code, '/app/a.ts', { ssr: false });
    expect(result).not.toBeNull();
    const out = (result as { code: string }).code;
    // Handler stripped.
    expect(out).not.toContain('SECRET');
    // html`` compiled to DOM creation calls.
    expect(out).toContain('document.createElement');
  });
});
