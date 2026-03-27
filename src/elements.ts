import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot content types
// ---------------------------------------------------------------------------

type SlotContent<E = unknown> =
  | Node
  | DocumentFragment
  | string
  | ((exposed: E) => Node | DocumentFragment | string)
  | null
  | undefined;

type SlotMap = Record<string, SlotContent>;

// ---------------------------------------------------------------------------
// SlotAccessor — returned by slot(), call it to render
// ---------------------------------------------------------------------------

export interface SlotAccessor {
  /** Render slot with no exposed props */
  (): Node | null;
  /** Render slot with exposed props (OUT / BOTH) */
  <E>(exposed: E): Node | null;
}

// ---------------------------------------------------------------------------
// slot(name?) — context-aware slot primitive
//
// Reads from the current component's children. Works like onMount() —
// must be called inside a component() body.
//
//   const Card = component((props) => {
//     const header = slot('header');
//     const body = slot();          // default slot
//     return html`<div>${header()}${body({ validate })}</div>`;
//   });
// ---------------------------------------------------------------------------

export function slot(name?: string): SlotAccessor {
  const ctx = getCurrentContext();
  if (!ctx) {
    throw new Error('slot() must be called inside a component');
  }

  const slotName = name ?? 'default';
  const children = ctx._slotContent;

  return ((exposed?: unknown): Node | null => {
    return resolveFromContent(children, slotName, exposed);
  }) as SlotAccessor;
}

function resolveFromContent(children: unknown, name: string, exposed: unknown): Node | null {
  if (children == null) return null;

  // Named slots: { default, header, footer, ... }
  if (
    typeof children === 'object' &&
    !(children instanceof Node) &&
    typeof children !== 'function'
  ) {
    const slots = children as SlotMap;
    return resolveSlot(slots[name], exposed);
  }

  // Default slot only
  if (name !== 'default') return null;
  return resolveSlot(children as SlotContent, exposed);
}

function resolveSlot(content: SlotContent | undefined, exposed: unknown): Node | null {
  if (content == null) return null;

  // Render function — scoped slot
  if (typeof content === 'function') {
    const result = content(exposed);
    if (result instanceof Node) return result;
    if (typeof result === 'string') return document.createTextNode(result);
    return null;
  }

  if (content instanceof Node) return content;
  return document.createTextNode(String(content));
}

// ---------------------------------------------------------------------------
// component(renderFn) — define a reusable component
//
//   // With slot() as context-aware primitive:
//   const Card = component<{ title: string }>((props) => {
//     const body = slot();
//     return html`<div><h2>${props.title}</h2>${body()}</div>`;
//   });
//
//   // IN:  Card({ title: 'Hi' }, html`<p>Body</p>`)
//   // OUT: Form({}, ({ isValid }) => html`...`)
//   // BOTH: Search({}, ({ query }) => html`${() => query()}`)
// ---------------------------------------------------------------------------

type RenderFn<P> = (props: P) => Node | DocumentFragment;

export function component<P extends Record<string, unknown> = Record<string, never>>(
  renderFn: RenderFn<P>,
): (props: P, children?: SlotContent | SlotMap) => Node | DocumentFragment {
  return (props: P, children?: SlotContent | SlotMap) => {
    const ctx = new ComponentContext();
    const parentCtx = getCurrentContext();
    if (parentCtx) {
      ctx.parent = parentCtx;
      parentCtx.children.push(ctx);
    }

    // Store children on context so slot() can read them
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
  };
}

// ---------------------------------------------------------------------------
// teleport(target, viewFn?) — context-aware, renders content elsewhere
//
// As a standalone:
//   html`${teleport('#modal-root', () => html`<div>...</div>`)}`
//
// Inside a component with slot:
//   const Modal = component((props) => {
//     const content = slot();
//     teleport('#modal-root', () => content());
//     return html`<!--modal-->`;
//   });
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
