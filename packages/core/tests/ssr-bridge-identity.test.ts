import { describe, expect, it } from 'vite-plus/test';
import { getSSRRenderContext as bridgeContext } from '@purityjs/core/ssr-bridge';
import { ensureSSRComponentRendererInstalled } from '../../ssr/src/component.ts';
import { when } from '../src/control.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { isSSRHtml, valueToHtml } from '@purityjs/ssr/runtime';
import { makeSSRContext } from './_helpers.ts';

describe('SSR test integration', () => {
  it('shares the active context and installed renderer with the core source', () => {
    const ctx = makeSSRContext();
    ensureSSRComponentRendererInstalled();
    pushSSRRenderContext(ctx);
    try {
      expect(bridgeContext()).toBe(ctx);
      const result = when(
        () => true,
        () => 'hello',
      );
      expect(isSSRHtml(result)).toBe(true);
      expect(valueToHtml(result)).toContain('hello');
    } finally {
      popSSRRenderContext();
    }
  });
});
