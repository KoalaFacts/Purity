import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot types
// ---------------------------------------------------------------------------

export type SlotAccessor<E = void> = E extends void
  ? () => Node | null
  : (exposed: E) => Node | null;

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

type ConsumerSlot = (content?: Node | DocumentFragment | string | null) => Node | null;

function createConsumerBag(registry: SlotRegistry): Record<string, ConsumerSlot> {
  const bag: Record<string, ConsumerSlot> = {};
  const names = new Set([...registry.accessorNames, 'default']);
  for (const name of names) {
    bag[name] = (content?: Node | DocumentFragment | string | null): Node | null => {
      registry.filled.set(name, content ?? null);
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
    const s = (children as Record<string, unknown>)[name];
    if (typeof s === 'function') {
      const r = (s as (...a: any[]) => unknown)(exposed);
      if (r instanceof Node) return r as Node;
      if (typeof r === 'string') return document.createTextNode(r);
      return null;
    }
    return resolveContent(s);
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
// RenderOutput — component can return DOM + exposed data
// ---------------------------------------------------------------------------

interface RenderOutput {
  view: Node | DocumentFragment;
  expose?: Record<string, unknown>;
}

type RenderFn<P, S> = (
  props: P,
  slots: { [K in keyof S]: SlotAccessor<S[K]> },
) => Node | DocumentFragment | RenderOutput;

// ---------------------------------------------------------------------------
// Internal: run component render with registry
// ---------------------------------------------------------------------------

function runRender<P, S>(
  renderFn: RenderFn<P, S>,
  props: P,
  slotAccessors: any,
  ctx: ComponentContext,
): { result: Node | DocumentFragment; exposed: Record<string, unknown> } {
  let exposed: Record<string, unknown> = {};

  pushContext(ctx);
  let output: Node | DocumentFragment | RenderOutput;
  try {
    output = renderFn(props, slotAccessors);
  } finally {
    popContext();
  }

  let result: Node | DocumentFragment;
  if (output && typeof output === 'object' && 'view' in output) {
    const ro = output as RenderOutput;
    result = ro.view;
    exposed = ro.expose ?? {};
  } else {
    result = output as Node | DocumentFragment;
  }

  return { result, exposed };
}

// ---------------------------------------------------------------------------
// component(tagName, renderFn) — define a component as a custom element
//
//   const Card = component('p-card', <Props, Slots>)(
//     ({ title }, { default: body }) => {
//       return html`<div><h2>${title}</h2>${body()}</div>`;
//     }
//   );
//
//   // In templates:
//   html`<p-card :title=${title} @saved=${handler}>
//     <p>Slot content</p>
//   </p-card>`
//
//   // Or programmatic:
//   Card({ title: 'Hi' }, html`<p>Body</p>`)
// ---------------------------------------------------------------------------

// Registry of component render functions by tag name
const componentRegistry = new Map<string, RenderFn<any, any>>();

export function component<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(
  tagName: string,
  renderFn: RenderFn<P, S>,
): (props: P, children?: any) => Node | DocumentFragment {
  // Store in registry
  componentRegistry.set(tagName, renderFn);

  // Register as Custom Element
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    const render = renderFn;

    class PurityElement extends HTMLElement {
      _ctx: ComponentContext | null = null;
      _props: Record<string, unknown> = {};
      _mounted = false;

      connectedCallback() {
        // Collect props set via :prop bindings (stored as JS properties)
        const props = { ...this._props } as P;

        // Collect event handlers set via @event (stored as __purity_event_*)
        const eventProps: Record<string, unknown> = {};
        for (const key of Object.keys(this)) {
          if (key.startsWith('__purity_event_')) {
            const eventName = key.slice('__purity_event_'.length);
            eventProps[`on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`] = (
              this as any
            )[key];
          }
        }

        const allProps = { ...props, ...eventProps } as P;

        // Collect slot content from light DOM children
        const registry = createRegistry();
        const slotAccessors = createAccessors(registry);

        // Light DOM → default slot
        if (this.childNodes.length > 0) {
          const frag = document.createDocumentFragment();
          while (this.firstChild) {
            frag.appendChild(this.firstChild);
          }
          registry.filled.set('default', frag);
        }

        const ctx = new ComponentContext();
        const parentCtx = getCurrentContext();
        if (parentCtx) {
          ctx.parent = parentCtx;
          parentCtx.children.push(ctx);
        }
        this._ctx = ctx;

        const { result } = runRender(render, allProps, slotAccessors, ctx);

        this.appendChild(result);

        if (result instanceof DocumentFragment) {
          ctx.nodes = Array.from(this.childNodes);
        } else {
          ctx.nodes = [result];
        }

        ctx._run(ctx.beforeMount);
        ctx._isMounted = true;
        this._mounted = true;

        queueMicrotask(() => ctx._run(ctx.mounted));
      }

      disconnectedCallback() {
        if (this._ctx) {
          this._ctx._run(this._ctx.beforeDestroy);
          for (const dispose of this._ctx.disposers) {
            try {
              dispose();
            } catch {}
          }
          this._ctx._isDestroyed = true;
          this._ctx._isMounted = false;
          this._ctx._run(this._ctx.destroyed);
        }
      }
    }

    customElements.define(tagName, PurityElement);
  }

  // Also return a programmatic factory (for non-template usage)
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

    // Pre-fill registry for non-callback children
    if (children != null && typeof children !== 'function') {
      if (children instanceof Node || typeof children === 'string') {
        registry.filled.set('default', children);
      } else if (typeof children === 'object') {
        for (const [k, v] of Object.entries(children as Record<string, unknown>)) {
          registry.filled.set(k, v);
        }
      }
    }

    if (typeof children === 'function') {
      // Pass 1: discover slots + collect exposed data
      const { exposed } = runRender(renderFn, props, slotAccessors, ctx);

      // Build consumer bag
      const bag = { ...createConsumerBag(registry), ...exposed };
      const consumerResult = children(bag);

      if (consumerResult instanceof Node) {
        registry.filled.set('default', consumerResult);
      } else if (typeof consumerResult === 'string') {
        registry.filled.set('default', consumerResult);
      }

      // Pass 2: re-render with filled slots
      const { result } = runRender(renderFn, props, slotAccessors, ctx);

      if (result instanceof DocumentFragment) {
        ctx.nodes = Array.from(result.childNodes);
      } else {
        ctx.nodes = [result];
      }

      ctx._run(ctx.beforeMount);
      ctx._isMounted = true;
      queueMicrotask(() => ctx._run(ctx.mounted));

      return result;
    }

    // Single render for non-callback
    const { result } = runRender(renderFn, props, slotAccessors, ctx);

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
