declare const __SSR__: boolean | undefined;

export const ENABLE_SSR = typeof __SSR__ === 'undefined' || __SSR__;
