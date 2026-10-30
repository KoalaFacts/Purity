import { describe, expect, it } from 'vite-plus/test';
import { onDestroy, onMount, unmountContext } from '../src/component.ts';
import { onFormReset } from '../src/forms.ts';
import { component } from '../src/elements.ts';
import { ComponentContext, popContext, pushContext } from '@purityjs/signals';

describe('SV2-015 lean component ownership', () => {
  it('does not allocate unused optional fields on ordinary owners', () => {
    const ctx = new ComponentContext();
    const optionalFields = [
      'mounted',
      'destroyed',
      'errorHandlers',
      'children',
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
    expect(ctx.disposers).toBeUndefined();
    expect(ctx._isDestroyed).toBeFalsy();

    const reset = () => {};
    const mounted = () => {};
    pushContext(ctx);
    try {
      onFormReset(reset);
      onMount(mounted);
    } finally {
      popContext();
    }
    expect(ctx._formReset).toEqual([reset]);
    expect(ctx.mounted).toEqual([mounted]);
    expect(Object.hasOwn(ctx, '_formReset')).toBe(true);
    expect(Object.hasOwn(ctx, 'mounted')).toBe(true);
  });

  it('keeps never-used optional fields absent after root teardown', () => {
    const ctx = new ComponentContext();
    unmountContext(ctx);
    expect(ctx._isDestroyed).toBe(true);
    for (const key of ['mounted', 'destroyed', 'errorHandlers', '_slotContent']) {
      expect(Object.hasOwn(ctx, key)).toBe(false);
    }
  });

  it('releases a detached custom-element owner and preserves reentrant reconnect', () => {
    let host!: HTMLElement & { _ctx: ComponentContext | null };
    let reconnect = true;
    let destroyed = 0;
    const name = 'p-sv2-lazy-owner-detach';
    component(name, () => {
      onDestroy(() => {
        destroyed++;
        if (reconnect) {
          reconnect = false;
          document.body.append(host);
        }
      });
      return document.createElement('span');
    });

    host = document.createElement(name) as typeof host;
    document.body.append(host);
    const first = host._ctx;
    expect(first).toBeInstanceOf(ComponentContext);

    host.remove();
    expect(destroyed).toBe(1);
    expect(host.isConnected).toBe(true);
    expect(host._ctx).toBeInstanceOf(ComponentContext);
    expect(host._ctx).not.toBe(first);

    host.remove();
    expect(destroyed).toBe(2);
    expect(host._ctx).toBeNull();
  });
});
