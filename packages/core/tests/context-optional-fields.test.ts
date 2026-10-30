import { describe, expect, it } from 'vite-plus/test';
import { onDestroy, onDispose, onMount, unmountContext } from '../src/component.ts';
import { onFormReset } from '../src/forms.ts';
import { component, slot } from '../src/elements.ts';
import { ComponentContext, getCurrentComponent, popContext, pushContext } from '@purityjs/signals';

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

  it('keeps a programmatic owner free of slot state when children are omitted', () => {
    let owner: ComponentContext | null = null;
    const render = component('p-sv2-no-slot-owner', () => {
      owner = getCurrentComponent();
      expect(slot()()).toBeNull();
      return document.createElement('span');
    });

    render({});
    expect(owner).toBeInstanceOf(ComponentContext);
    expect(Object.hasOwn(owner!, '_slotContent')).toBe(false);
    unmountContext(owner!);
  });

  it('keeps never-used optional fields absent after root teardown', () => {
    const ctx = new ComponentContext();
    unmountContext(ctx);
    expect(ctx._isDestroyed).toBe(true);
    for (const key of ['mounted', 'destroyed', 'errorHandlers', '_slotContent']) {
      expect(Object.hasOwn(ctx, key)).toBe(false);
    }
  });

  it('releases detached host node references without clearing its shadow DOM', () => {
    let owner: ComponentContext | null = null;
    const tag = 'p-sv2-kept-host-nodes';
    component(tag, () => {
      owner = getCurrentComponent();
      return document.createElement('span');
    });

    const host = document.createElement(tag);
    document.body.append(host);
    const originalNode = host.shadowRoot?.firstChild;
    expect(originalNode).toBeInstanceOf(Node);

    host.remove();
    expect(host.shadowRoot?.firstChild).toBe(originalNode);
    expect(owner).toBeInstanceOf(ComponentContext);
    expect(owner!._isDestroyed).toBe(true);
    expect(owner!.nodes).toBeNull();
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
  it('preserves original function-returned fragments during raw slot projection', () => {
    const fragment = document.createDocumentFragment();
    const child = document.createTextNode('original');
    fragment.append(child);
    const render = component('p-sv2-raw-slot-fragment', () => {
      const root = document.createElement('div');
      const content = slot()();
      if (content) root.append(content);
      return root;
    });

    const root = render({}, { default: () => fragment }) as Element;
    expect(root.firstChild).toBe(child);
    expect(fragment.childNodes).toHaveLength(0);
  });

  it('keeps raw slot lookup live when the original bag is updated', () => {
    let read!: () => Node | null;
    const render = component('p-sv2-live-raw-slot-bag', () => {
      read = slot('header');
      return document.createElement('div');
    });

    const raw = { header: 'first' };
    render({}, raw);
    expect(read()?.textContent).toBe('first');

    raw.header = 'second';
    expect(read()?.textContent).toBe('second');
  });

  it('defers consumer callbacks until the slot bag exists when using slot()', () => {
    let calls = 0;
    const render = component('p-sv2-deferred-raw-slot-consumer', () => {
      const root = document.createElement('div');
      const content = slot()();
      if (content) root.append(content);
      return root;
    });

    const root = render({}, (slots: Record<string, (text: string) => Node | null>) => {
      calls++;
      slots.default('body');
    }) as Element;

    expect(calls).toBe(1);
    expect(root.textContent).toBe('body');
  });

  it('provides the default consumer slot even when only named accessors are read', () => {
    const render = component<Record<string, never>, { header: void }>(
      'p-sv2-consumer-slot-set',
      (_props, slots) => {
        const root = document.createElement('div');
        const header = slots.header();
        if (header) root.append(header);
        return root;
      },
    );
    const root = render({}, (slots: Record<string, (text: string) => Node | null>) => {
      slots.header('heading');
      slots.default('body');
    }) as Element;
    expect(root.textContent).toBe('heading');
  });

  it('reuses a previously read default accessor across consumer slot filling', () => {
    let first!: () => Node | null;
    const render = component<Record<string, never>, { default: void }>(
      'p-sv2-consumer-default-cache',
      (_props, slots) => {
        const accessor = slots.default;
        if (!first) first = accessor;
        expect(accessor).toBe(first);
        const root = document.createElement('div');
        const content = accessor();
        if (content) root.append(content);
        return root;
      },
    );
    const root = render({}, (slots: Record<string, (text: string) => Node | null>) => {
      slots.default('body');
    }) as Element;
    expect(root.textContent).toBe('body');
  });

  it('ignores inherited raw slot methods instead of invoking them', () => {
    const render = component('p-sv2-inherited-raw-slots', () => {
      const root = document.createElement('div');
      for (const name of ['toString', 'hasOwnProperty', 'constructor']) {
        const content = slot(name)();
        if (content) root.append(content);
      }
      const content = slot()();
      if (content) root.append(content);
      return root;
    });

    expect((render({}, { default: 'body' }) as Element).textContent).toBe('body');
  });

  it('preserves prototype-named slot keys through raw and consumer children', () => {
    const render = component<Record<string, never>, Record<string, void>>(
      'p-sv2-prototype-slot-keys',
      (_props, slots) => {
        const root = document.createElement('div');
        for (const name of ['__proto__', 'constructor', 'toString']) {
          const content = slots[name]();
          if (content) root.append(content);
        }
        return root;
      },
    );

    const raw: Record<string, string> = Object.create(null);
    raw['__proto__'] = 'a';
    raw['constructor'] = 'b';
    raw['toString'] = 'c';
    expect((render({}, raw) as Element).textContent).toBe('abc');

    const consumer = render({}, (slots: Record<string, (value: string) => Node | null>) => {
      slots['__proto__']('a');
      slots['constructor']('b');
      slots['toString']('c');
    }) as Element;
    expect(consumer.textContent).toBe('abc');
  });

  it('releases used slot and parent references without allocating absent owner fields', () => {
    const parent = new ComponentContext();
    const child = new ComponentContext();
    parent.children = [child];
    child.parent = parent;
    child._slotContent = document.createElement('span');

    unmountContext(child);
    expect(child._slotContent).toBeUndefined();
    expect(child.parent).toBeNull();
    expect(parent.children).toEqual([]);

    const root = new ComponentContext();
    unmountContext(root);
    expect(Object.hasOwn(root, 'parent')).toBe(false);
    expect(Object.hasOwn(root, '_slotContent')).toBe(false);
  });

  it('clears falsy provided slot values while keeping an absent slot unallocated', () => {
    for (const value of [null, false, 0, '']) {
      const ctx = new ComponentContext();
      ctx._slotContent = value;
      unmountContext(ctx);
      expect(ctx._slotContent).toBeUndefined();
    }

    const absent = new ComponentContext();
    unmountContext(absent);
    expect(Object.hasOwn(absent, '_slotContent')).toBe(false);
  });
  it('rolls back a failed consumer callback without leaking its component owner', () => {
    const parent = new ComponentContext();
    let disposed = 0;
    let destroyed = 0;
    const render = component('p-sv2-consumer-rollback', () => {
      onDispose(() => disposed++);
      onDestroy(() => destroyed++);
      return document.createElement('div');
    });

    pushContext(parent);
    try {
      expect(() =>
        render({}, () => {
          throw new Error('consumer failed');
        }),
      ).toThrow('consumer failed');
      expect(disposed).toBe(1);
      expect(destroyed).toBe(0);
      expect(parent.children).toEqual([]);
    } finally {
      popContext();
    }
  });
});
