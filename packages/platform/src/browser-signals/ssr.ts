import { getSSRRenderContext } from '@purityjs/core/ssr-bridge';

declare const __SSR__: boolean | undefined;

export function isSSR(): boolean {
  return (typeof __SSR__ === 'undefined' || __SSR__) && getSSRRenderContext() !== null;
}
