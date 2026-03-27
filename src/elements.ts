import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot type system
//
// Slots are declared in the component's second generic parameter:
//   component<Props, Slots>
//
// S = { slotName: ExposedPropsType }
//   - void means no exposed props (IN only — static content)
//   - object means scoped slot with exposed props (OUT / BOTH)
//
// Example:
//   component<
//     { title: string },
//     { header: void; default: { validate: () => boolean } }
//   >
// ---------------------------------------------------------------------------

/** What the consumer provides for a single slot */
type SlotInput<E> = E extends void
  ? Node | DocumentFragment | string | (() => Node | DocumentFragment | string) | null | undefined
  : ((exposed: E) => Node | DocumentFragment | string) | null | undefined;

/** Map of consumer-provided slot content, typed per slot */
type SlotInputMap<S> = { [K in keyof S]?: SlotInput<S[K]> };

/** What component() returns — the callable factory */
type ComponentFactory<P, S> =
  // Single default slot with void = accept plain content or nothing
  keyof S extends 'default'
    ? S extends { default: void }
      ? (props: P, children?: SlotInput<void>) => Node | DocumentFragment
      : (props: P, children?: SlotInput<S[keyof S]> | SlotInputMap<S>) => Node | DocumentFragment
    : (props: P, children?: SlotInputMap<S>) => Node | DocumentFragment;

/** Typed accessor returned by slot() inside a component */
export type SlotAccessor<E = void> = E extends void
  ? () => Node | null
  : (exposed: E) => Node | null;

// ---------------------------------------------------------------------------
// slot(name?) — context-aware, strongly typed slot primitive
//
//   const Card = component<
//     { title: string },
//     { header: void; default: { validate: () => boolean } }
//   >((props) => {
//     const header = slot<void>('header');
//     const body = slot<{ validate: () => boolean }>();
//     return html`...${header()}...${body({ validate })}...`;
//   });
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
// Internal resolution
// ---------------------------------------------------------------------------

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
// component<Props, Slots>(renderFn) — define a typed component
//
//   // No slots:
//   const Tag = component<{ label: string }>((props) => html`<span>${props.label}</span>`);
//
//   // Default slot, no exposed props (IN):
//   const Card = component<{ title: string }, { default: void }>((props) => {
//     const body = slot();
//     return html`<div>${body()}</div>`;
//   });
//   Card({ title: 'Hi' }, html`<p>Body</p>`)
//
//   // Scoped slot (OUT):
//   const Form = component<{}, { default: { isValid: boolean } }>((props) => {
//     const body = slot<{ isValid: boolean }>();
//     return html`<form>${body({ isValid: true })}</form>`;
//   });
//   Form({}, ({ isValid }) => html`<button ?disabled=${!isValid}>Save</button>`)
//
//   // Named typed slots:
//   const Layout = component<{}, {
//     header: { user: User };
//     default: void;
//     footer: void;
//   }>((props) => {
//     const header = slot<{ user: User }>('header');
//     const body = slot();
//     const footer = slot('footer');
//     return html`...`;
//   });
// ---------------------------------------------------------------------------

type RenderFn<P> = (props: P) => Node | DocumentFragment;

export function component<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(renderFn: RenderFn<P>): ComponentFactory<P, S> {
  return ((props: P, children?: unknown) => {
    const ctx = new ComponentContext();
    const parentCtx = getCurrentContext();
    if (parentCtx) {
      ctx.parent = parentCtx;
      parentCtx.children.push(ctx);
    }

    ctx._slotContent = children;

    pushContext(ctx);

    let result: Node | DocumentFragment;
    try {
      result = renderFn(props);
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
// reactiveTeleport(target, viewFn) — reactive version, re-renders on change
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
