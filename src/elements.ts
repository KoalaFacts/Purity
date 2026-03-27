import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot types — a slot is a built-in component with in/out/both-way binding
//
// IN:   parent passes static content → slot()
// OUT:  component exposes data → slot(exposedProps) → parent render fn
// BOTH: component exposes state accessors → parent reads AND writes
// ---------------------------------------------------------------------------

type SlotContent<E = unknown> =
  | Node
  | DocumentFragment
  | string
  | ((exposed: E) => Node | DocumentFragment | string)
  | null
  | undefined;

type SlotMap<E = unknown> = Record<string, SlotContent<E>>;

export interface SlotFn {
  /** Render default slot with no exposed props */
  (): Node | null;
  /** Render default slot with exposed props (OUT / BOTH) */
  <E>(exposed: E): Node | null;
  /** Render named slot with no exposed props */
  (name: string): Node | null;
  /** Render named slot with exposed props */
  <E>(name: string, exposed: E): Node | null;
}

function createSlotFn(children?: SlotContent | SlotMap): SlotFn {
  return ((...args: any[]): Node | null => {
    if (children == null) return null;

    // Parse args: (name?, exposed?)
    let name: string | undefined;
    let exposed: unknown;

    if (args.length === 0) {
      name = 'default';
    } else if (args.length === 1) {
      if (typeof args[0] === 'string') {
        name = args[0];
      } else {
        // Single non-string arg = exposed props for default slot
        name = 'default';
        exposed = args[0];
      }
    } else {
      name = args[0];
      exposed = args[1];
    }

    // Named slots: { default, header, footer, ... }
    if (
      typeof children === 'object' &&
      !(children instanceof Node) &&
      typeof children !== 'function'
    ) {
      const slots = children as SlotMap;
      return resolveSlot(slots[name!], exposed);
    }

    // Default slot only
    if (name && name !== 'default') return null;
    return resolveSlot(children as SlotContent, exposed);
  }) as SlotFn;
}

function resolveSlot(content: SlotContent | undefined, exposed: unknown): Node | null {
  if (content == null) return null;

  // Render function — call with exposed props (scoped slot)
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
// component(renderFn) — define a reusable component with props + slots
//
//   // IN: static slot content
//   const Card = component<{ title: string }>((props, slot) => {
//     return html`<div><h2>${props.title}</h2>${slot()}</div>`;
//   });
//   Card({ title: 'Hi' }, html`<p>Body</p>`)
//
//   // OUT: expose data through slot
//   const Form = component((props, slot) => {
//     const isValid = compute(() => ...);
//     return html`<form>${slot({ isValid, submit })}</form>`;
//   });
//   Form({}, ({ isValid, submit }) => html`
//     <button @click=${submit} ?disabled=${() => !isValid()}>Save</button>
//   `)
//
//   // BOTH: expose state accessor, parent reads AND writes
//   const Search = component((props, slot) => {
//     const query = state('');
//     return html`<div><input bind:value=${query} />${slot({ query })}</div>`;
//   });
//   Search({}, ({ query }) => html`
//     <p>Searching: ${() => query()}</p>
//     <button @click=${() => query('')}>Clear</button>
//   `)
//
//   // Named scoped slots:
//   Layout({}, {
//     header: ({ user }) => html`<h1>Hi ${user.name}</h1>`,
//     default: html`<p>Main</p>`,
//     footer: html`<small>Footer</small>`,
//   })
// ---------------------------------------------------------------------------

type RenderFn<P> = (props: P, slot: SlotFn) => Node | DocumentFragment;

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

    pushContext(ctx);

    const slot = createSlotFn(children);

    let result: Node | DocumentFragment;
    try {
      result = renderFn(props, slot);
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
// teleport(target, viewFn) — render content to a different DOM location
//
//   html`${teleport('#modal-root', () => html`<div class="modal">...</div>`)}`
// ---------------------------------------------------------------------------

export function teleport(target: string | Element, viewFn: () => Node | DocumentFragment): Comment {
  const anchor = document.createComment('teleport');

  queueMicrotask(() => {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      console.warn(`teleport: target "${String(target)}" not found`);
      return;
    }

    const content = viewFn();
    if (content) container.appendChild(content);
  });

  return anchor;
}

// ---------------------------------------------------------------------------
// reactiveTeleport(target, viewFn) — reactive version, re-renders on change
//
//   html`${reactiveTeleport('#overlay', () => visible() ? html`<Modal/>` : null)}`
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
