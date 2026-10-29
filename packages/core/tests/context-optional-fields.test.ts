import { describe, expect, it } from 'vite-plus/test';
import { onFormReset } from '../src/component.ts';
import { ComponentContext, popContext, pushContext } from '../src/scope.ts';

describe('SV2-015 lean component ownership', () => {
  it('does not allocate unused optional fields on ordinary owners', () => {
    const ctx = new ComponentContext();
    const optionalFields = [
      '_slotContent',
      '_internals',
      '_stateRefs',
      '_formAssociated',
      '_formDisabled',
      '_formReset',
      '_formStateRestore',
    ];

    for (let i = 0; i < optionalFields.length; i++) {
      const key = optionalFields[i];
      expect(Object.hasOwn(ctx, key)).toBe(false);
      expect((ctx as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }

    // Lifecycle essentials still have their existing initial value.
    expect(ctx.disposers).toBeNull();
    expect(ctx._isDestroyed).toBe(false);

    const reset = () => {};
    pushContext(ctx);
    try {
      onFormReset(reset);
    } finally {
      popContext();
    }
    expect(ctx._formReset).toEqual([reset]);
    expect(Object.hasOwn(ctx, '_formReset')).toBe(true);
  });
});
