import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot type system
//
// Slots are declared as the second generic on component<Props, Slots>.
// Each key is a slot name, value is the type of exposed props.
// void = no exposed props (IN only — static content).
//
//   component<
//     { title: string },
//     { header: void; default: { validate: () => boolean } }
//   >(({ title }, { header, default: body }) => { ... })
// ---------------------------------------------------------------------------

/** Typed accessor — call it to render the slot content */
export type SlotAccessor<E = void> = E extends void
  ? () => Node | null
  : (exposed: E) => Node | null;

/** Map of typed slot accessors, built from the Slots generic */
type SlotAccessors<S> = { [K in keyof S]: SlotAccessor<S[K]> };

/** What the consumer provides for a single slot */
type SlotInput<E> = E extends void
  ? Node | DocumentFragment | string | (() => Node | DocumentFragment | string) | null | undefined
  : ((exposed: E) => Node | DocumentFragment | string) | null | undefined;

/** Map of consumer-provided slot content, typed per slot */
type SlotInputMap<S> = { [K in keyof S]?: SlotInput<S[K]> };

/** What component() returns — the callable factory */
type ComponentFactory<P, S> = keyof S extends never
  ? (props: P) => Node | DocumentFragment
  : keyof S extends 'default'
    ? S extends { default: void }
      ? (props: P, children?: SlotInput<void>) => Node | DocumentFragment
      : (props: P, children?: SlotInput<S[keyof S]> | SlotInputMap<S>) => Node | DocumentFragment
    : (props: P, children?: SlotInputMap<S>) => Node | DocumentFragment;

// ---------------------------------------------------------------------------
// Internal: build SlotAccessors from children
// ---------------------------------------------------------------------------

function buildSlotAccessors(children: unknown): Record<string, SlotAccessor<any>> {
  const accessors: Record<string, SlotAccessor<any>> = {};

  return new Proxy(accessors, {
    get(_target, prop: string) {
      if (typeof prop !== 'string') return undefined;

      // Return a slot accessor function
      return (exposed?: unknown): Node | null => {
        return resolveFromContent(children, prop, exposed);
      };
    },
  });
}

function resolveFromContent(children: unknown, name: string, exposed: unknown): Node | null {
  if (children == null) return null;

  // Named slots map: { default, header, footer, ... }
  if (
    typeof children === 'object' &&
    !(children instanceof Node) &&
    typeof children !== 'function'
  ) {
    const slots = children as Record<string, unknown>;
    return resolveSlot(slots[name], exposed);
  }

  // Default slot only
  if (name !== 'default') return null;
  return resolveSlot(children, exposed);
}

function resolveSlot(content: unknown, exposed: unknown): Node | null {
  if (content == null) return null;

  if (typeof content === 'function') {
    const result = (content as (...args: any[]) => unknown)(exposed);
    if (result instanceof Node) return result as Node;
    if (typeof result === 'string') return document.createTextNode(result);
    return null;
  }

  if (content instanceof Node) return content;
  if (typeof content === 'string') return document.createTextNode(content);
  return null;
}

// ---------------------------------------------------------------------------
// slot(name?) — context-aware slot primitive (still works standalone)
// ---------------------------------------------------------------------------

export function slot<E = void>(name?: string): SlotAccessor<E> {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error('slot() must be called inside a component');
  }

  const slotName = name ?? 'default';
  const children = ctx._slotContent;

  return ((exposed?: unknown): Node | null => {
    return resolveFromContent(children, slotName, exposed);
  }) as SlotAccessor<E>;
}

// ---------------------------------------------------------------------------
// component<Props, Slots>(renderFn) — define a typed component
//
//   // Destructured props + slots:
//   const Card = component<
//     { title: string },
//     { header: void; default: { validate: () => boolean } }
//   >(({ title }, { header, default: body }) => {
//     return html`
//       <h2>${title}</h2>
//       ${header()}
//       ${body({ validate: isValid })}
//     `;
//   });
//
//   // Consumer:
//   Card({ title: 'Hi' }, {
//     header: html`<h1>Title</h1>`,
//     default: ({ validate }) => html`<button>Save</button>`,
//   })
// ---------------------------------------------------------------------------

type RenderFn<P, S> = (props: P, slots: SlotAccessors<S>) => Node | DocumentFragment;

export function component<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(renderFn: RenderFn<P, S>): ComponentFactory<P, S> {
  return ((props: P, children?: unknown) => {
    const ctx = new ComponentContext();
    const parentCtx = getCurrentContext();
    if (parentCtx) {
      ctx.parent = parentCtx;
      parentCtx.children.push(ctx);
    }

    ctx._slotContent = children;

    pushContext(ctx);

    const slots = buildSlotAccessors(children) as SlotAccessors<S>;

    let result: Node | DocumentFragment;
    try {
      result = renderFn(props, slots);
    } catch (err) {
      popContext();
      ctx._handleError(err);
      return document.createComment('component-error');
    }

    popContext();

    if (result instanceof DocumentFragment) {
      ctx.nodes = Array.from(result.childNodes);
    } else {
      ctx.nodes = [result];
    }

    ctx._run(ctx.beforeMount);
    ctx._isMounted = true;

    queueMicrotask(() => {
      ctx._run(ctx.mounted);
    });

    return result;
  }) as ComponentFactory<P, S>;
}

// ---------------------------------------------------------------------------
// teleport(target, viewFn?) — render content to a different DOM location
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
// reactiveTeleport(target, viewFn) — reactive version
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
