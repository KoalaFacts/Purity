import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot types
// ---------------------------------------------------------------------------

export type SlotAccessor<E = void> = E extends void
  ? () => Node | null
  : (exposed: E) => Node | null;

type ConsumerSlot = (content?: Node | DocumentFragment | string | null) => Node | null;

// ---------------------------------------------------------------------------
// Internal: slot registry
// ---------------------------------------------------------------------------

interface SlotRegistry {
  filled: Map<string, unknown>;
  accessorNames: Set<string>;
}

function createRegistry(): SlotRegistry {
  return { filled: new Map(), accessorNames: new Set() };
}

function createAccessors(registry: SlotRegistry): Record<string, SlotAccessor<any>> {
  return new Proxy({} as Record<string, SlotAccessor<any>>, {
    get(_target, prop: string) {
      if (typeof prop !== 'string') return undefined;
      registry.accessorNames.add(prop);
      return (_exposed?: unknown): Node | null => {
        const content = registry.filled.get(prop);
        return resolveContent(content);
      };
    },
  });
}

function createConsumerBag(registry: SlotRegistry): Record<string, ConsumerSlot> {
  const bag: Record<string, ConsumerSlot> = {};
  for (const name of registry.accessorNames) {
    bag[name] = (content?: Node | DocumentFragment | string | null): Node | null => {
      registry.filled.set(name, content ?? null);
      return null; // placeholder — real rendering happens on second pass
    };
  }
  // Always include 'default'
  if (!bag.default) {
    bag.default = (content?: Node | DocumentFragment | string | null): Node | null => {
      registry.filled.set('default', content ?? null);
      return null;
    };
  }
  return bag;
}

function resolveContent(content: unknown): Node | null {
  if (content == null) return null;
  if (content instanceof Node) return content;
  if (typeof content === 'string') return document.createTextNode(content);
  return null;
}

// ---------------------------------------------------------------------------
// slot(name?) — standalone context-aware primitive
// ---------------------------------------------------------------------------

export function slot<E = void>(name?: string): SlotAccessor<E> {
  const ctx = getCurrentContext();
  if (!ctx) throw new Error('slot() must be called inside a component');

  const slotName = name ?? 'default';
  const children = ctx._slotContent;

  return ((_exposed?: unknown): Node | null => {
    return resolveFromRaw(children, slotName, _exposed);
  }) as SlotAccessor<E>;
}

function resolveFromRaw(children: unknown, name: string, exposed: unknown): Node | null {
  if (children == null) return null;

  if (
    typeof children === 'object' &&
    !(children instanceof Node) &&
    typeof children !== 'function'
  ) {
    const slot = (children as Record<string, unknown>)[name];
    if (typeof slot === 'function') {
      const r = (slot as (...a: any[]) => unknown)(exposed);
      if (r instanceof Node) return r as Node;
      if (typeof r === 'string') return document.createTextNode(r);
      return null;
    }
    return resolveContent(slot);
  }

  if (name !== 'default') return null;
  if (typeof children === 'function') {
    const r = (children as (...a: any[]) => unknown)(exposed);
    if (r instanceof Node) return r as Node;
    if (typeof r === 'string') return document.createTextNode(r);
    return null;
  }
  return resolveContent(children);
}

// ---------------------------------------------------------------------------
// component<Props, Slots, Expose>(renderFn)
//
// Component controls layout. Consumer fills slots + gets exposed data.
//
// Usage A — callback (new syntax):
//   Card({ title: 'Hi' }, ({ header, validate }) => html`
//     ${header(html`<h1>...</h1>`)}
//     <button ?disabled=${() => !validate()}>Save</button>
//   `)
//
// Usage B — map (named slots):
//   Layout({}, { header: html`<h1>...</h1>`, default: html`<p>Main</p>` })
//
// Usage C — plain content (default slot):
//   Box({}, html`<p>Content</p>`)
// ---------------------------------------------------------------------------

interface RenderOutput<X> {
  view: Node | DocumentFragment;
  expose?: X;
}

type RenderFn<P, S> = (
  props: P,
  slots: { [K in keyof S]: SlotAccessor<S[K]> },
) => Node | DocumentFragment | RenderOutput<any>;

export function component<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(renderFn: RenderFn<P, S>): (props: P, children?: any) => Node | DocumentFragment {
  return (props: P, children?: any) => {
    const ctx = new ComponentContext();
    const parentCtx = getCurrentContext();
    if (parentCtx) {
      ctx.parent = parentCtx;
      parentCtx.children.push(ctx);
    }

    ctx._slotContent = children;
    const registry = createRegistry();
    const slotAccessors = createAccessors(registry);

    // --- Pre-fill registry for non-callback children ---
    if (children != null && typeof children !== 'function') {
      if (children instanceof Node || typeof children === 'string') {
        registry.filled.set('default', children);
      } else if (typeof children === 'object') {
        for (const [k, v] of Object.entries(children as Record<string, unknown>)) {
          registry.filled.set(k, v);
        }
      }
    }

    // --- First render (discovers slot accessor names) ---
    let result: Node | DocumentFragment;
    let exposed: Record<string, unknown> = {};

    const doRender = (): Node | DocumentFragment => {
      pushContext(ctx);
      try {
        const output = renderFn(props, slotAccessors as any);
        if (output && typeof output === 'object' && 'view' in output) {
          const ro = output as RenderOutput<any>;
          exposed = ro.expose ?? {};
          return ro.view;
        }
        return output as Node | DocumentFragment;
      } catch (err) {
        popContext();
        ctx._handleError(err);
        return document.createComment('component-error');
      } finally {
        popContext();
      }
    };

    if (typeof children === 'function') {
      // Pass 1: render to discover slot names + collect exposed data
      doRender();

      // Build consumer bag: slot fillers + exposed data
      const bag = { ...createConsumerBag(registry), ...exposed };

      // Call consumer callback — it fills slots via bag.header(...) etc.
      const consumerResult = children(bag);

      // If consumer returned content, treat as default slot
      if (consumerResult instanceof Node) {
        registry.filled.set('default', consumerResult);
      } else if (typeof consumerResult === 'string') {
        registry.filled.set('default', consumerResult);
      }

      // Pass 2: re-render with filled slots
      result = doRender();
    } else {
      // Non-callback: registry already pre-filled, single render
      result = doRender();
    }

    if (result instanceof DocumentFragment) {
      ctx.nodes = Array.from(result.childNodes);
    } else {
      ctx.nodes = [result];
    }

    ctx._run(ctx.beforeMount);
    ctx._isMounted = true;
    queueMicrotask(() => ctx._run(ctx.mounted));

    return result;
  };
}

// ---------------------------------------------------------------------------
// teleport
// ---------------------------------------------------------------------------

export function teleport(
  target: string | Element,
  viewFn?: () => Node | DocumentFragment | null,
): Comment {
  const anchor = document.createComment('teleport');
  queueMicrotask(() => {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      console.warn(`teleport: target "${String(target)}" not found`);
      return;
    }
    if (viewFn) {
      const content = viewFn();
      if (content) container.appendChild(content);
    }
  });
  return anchor;
}

// ---------------------------------------------------------------------------
// reactiveTeleport
// ---------------------------------------------------------------------------

export function reactiveTeleport(
  target: string | Element,
  viewFn: () => Node | DocumentFragment | null,
): Comment {
  const anchor = document.createComment('teleport');
  let currentNodes: Node[] = [];
  queueMicrotask(() => {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      console.warn(`teleport: target "${String(target)}" not found`);
      return;
    }
    watch(() => {
      for (const node of currentNodes) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
      currentNodes = [];
      const content = viewFn();
      if (content == null) return;
      if (content instanceof DocumentFragment) {
        currentNodes = Array.from(content.childNodes);
        container.appendChild(content);
      } else {
        currentNodes = [content];
        container.appendChild(content);
      }
    });
  });
  return anchor;
}
