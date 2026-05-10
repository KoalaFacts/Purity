// @vitest-environment jsdom
// Client-side tests for `getRequest()`. ADR 0009.
// SSR coverage lives in `@purityjs/ssr`'s request-context.test.ts.

import { describe, expect, it } from 'vitest';
import { getRequest } from '../src/index.ts';

describe('getRequest() — client behavior', () => {
  it('returns null when called outside an SSR context', () => {
    expect(getRequest()).toBeNull();
  });
});
