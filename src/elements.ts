import { ComponentContext, getCurrentContext, popContext, pushContext } from './component.js';
import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Slot types
// ---------------------------------------------------------------------------

type SlotContent = Node | DocumentFragment | string | null | undefined;

export interface SlotFn {
  (): Node | null;
  (name: string): Node | null;
}

function createSlotFn(children?: SlotContent | Record<string, SlotContent>): SlotFn {
  return ((name?: string): Node | null => {
    if (children == null) return null;

    // Named slots: { default, header, footer, ... }
    if (typeof children === 'object' && !(children instanceof Node)) {
      const key = name ?? 'default';
      return resolveContent((children as Record<string, SlotContent>)[key]);
    }

    // Default slot
    if (name && name !== 'default') return null;
    return resolveContent(children as SlotContent);
  }) as SlotFn;
}

function resolveContent(content: SlotContent): Node | null {
  if (content == null) return null;
  if (content instanceof Node) return content;
  return document.createTextNode(String(content));
}

// ---------------------------------------------------------------------------
// component(renderFn) — define a reusable component with props + slots
//
//   const Card = component<{ title: string }>((props, slot) => {
//     onMount(() => console.log('Card mounted'));
//     return html`<div><h2>${props.title}</h2>${slot()}</div>`;
//   });
//
//   // Default slot:
//   Card({ title: 'Hi' }, html`<p>Body</p>`)
//
//   // Named slots:
//   Layout({}, {
//     header: html`<h1>Title</h1>`,
//     default: html`<p>Main</p>`,
//     footer: html`<small>Footer</small>`,
//   })
// ---------------------------------------------------------------------------

type RenderFn<P> = (props: P, slot: SlotFn) => Node | DocumentFragment;

export function component<P extends Record<string, unknown> = Record<string, never>>(
  renderFn: RenderFn<P>,
): (props: P, children?: SlotContent | Record<string, SlotContent>) => Node | DocumentFragment {
  return (props: P, children?: SlotContent | Record<string, SlotContent>) => {
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
