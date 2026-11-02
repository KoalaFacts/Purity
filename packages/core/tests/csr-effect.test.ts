import { describe, expect, it, vi } from 'vite-plus/test';

// Exercise source entrypoints without rebuilding shared package artifacts.
vi.mock('@purityjs/signals', () => import('../../signals/src/index.ts'));

import * as csrRuntime from '../src/runtime/csr-runtime.ts';
import * as signals from '../../signals/src/index.ts';

describe('CSR template effect entry', () => {
  it('exposes the same internal effect from the shared signal graph', () => {
    const signalEffect = (signals as unknown as { watchEffectInternal?: unknown })
      .watchEffectInternal;
    const csrEffect = (csrRuntime as unknown as { watchEffectInternal?: unknown })
      .watchEffectInternal;
    expect(typeof signalEffect).toBe('function');
    expect(csrEffect).toBe(signalEffect);
  });
});
