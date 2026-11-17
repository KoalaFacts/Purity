// CQ-09e: the plugin's published hook signatures carry no `any`. Hooks take
// `this: unknown` (they also run without a Vite context) and read only the
// typed members of PurityHookContext.
import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import {
  purity,
  type PurityHookContext,
  type PurityOutputBundle,
  type PurityOutputOptions,
} from '../src/index.ts';

describe('vite-plugin hook types (CQ-09e)', () => {
  const plugin = purity({ strictAot: false });

  it('hooks take an unknown context instead of any', () => {
    expectTypeOf<ThisParameterType<typeof plugin.transform>>().toEqualTypeOf<unknown>();
    expectTypeOf<ThisParameterType<typeof plugin.load>>().toEqualTypeOf<unknown>();
    expectTypeOf<ThisParameterType<typeof plugin.generateBundle>>().toEqualTypeOf<unknown>();
    expectTypeOf<ThisParameterType<typeof plugin.handleHotUpdate>>().toEqualTypeOf<unknown>();
  });

  it('generateBundle takes typed output options and bundle', () => {
    expectTypeOf(plugin.generateBundle).parameter(0).toEqualTypeOf<PurityOutputOptions>();
    expectTypeOf(plugin.generateBundle).parameter(1).toEqualTypeOf<PurityOutputBundle>();
  });

  it('generateBundle skips the client asset check for a server environment context', () => {
    const bundle: PurityOutputBundle = {
      secret: { type: 'asset', originalFileNames: ['auth.server.ts'] },
    };
    const server: PurityHookContext = { environment: { config: { consumer: 'server' } } };
    expect(() => plugin.generateBundle.call(server, {}, bundle)).not.toThrow();
    const client: PurityHookContext = { environment: { config: { consumer: 'client' } } };
    expect(() => plugin.generateBundle.call(client, {}, bundle)).toThrow(
      /Server-only modules cannot/,
    );
    // No context at all behaves like a client build.
    expect(() => plugin.generateBundle.call(undefined, {}, bundle)).toThrow(
      /Server-only modules cannot/,
    );
  });

  it('warnings go to the context warn() with the context bound, else console.warn', () => {
    const code = 'import { html } from "@purityjs/core/jit";\nconst a = html`<my:x>y</my:x>`;';
    const seen: unknown[] = [];
    const ctx = {
      warn(this: unknown, message: string) {
        seen.push(this, message);
      },
    };
    plugin.transform.call(ctx, code, 'app.ts');
    expect(seen[0]).toBe(ctx);
    expect(String(seen[1])).toContain('failed to compile html``');

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      plugin.transform.call(42, code, 'app.ts');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('failed to compile html``'));
    } finally {
      spy.mockRestore();
    }
  });
});
