import {
  attachToOwner,
  ComponentContext,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
  watch,
} from '@purityjs/signals';
import { scheduleMountCallbacks, unmountContext } from './component.ts';
import {
  dsdHydrator,
  ENABLE_SSR,
  formElementSetup,
  type PurityElementHost,
  type SSRHtml,
} from './hooks.ts';

function unmountElementContext(
  ctx: ComponentContext,
  rollback = ctx.parent?._rollback,
  keepHostDOM = false,
): void {
  unmountContext(ctx, rollback, keepHostDOM, true);
}

/**
 * Accessor function returned by {@link slot} to project child content into a component.
 */
export type SlotAccessor<E = void> = E extends void
  ? () => Node | null
  : (exposed: E) => Node | null;

interface SlotRegistry {
  filled: Record<string, unknown>;
  accessors: Record<string, SlotAccessor<any> | undefined>;
}

function createRegistry(): SlotRegistry {
  return { filled: Object.create(null), accessors: Object.create(null) };
}

function createAccessors(registry: SlotRegistry): Record<string, SlotAccessor<any>> {
  return new Proxy({} as Record<string, SlotAccessor<any>>, {
    get(_target, prop: string) {
      /* v8 ignore next */
      if (typeof prop !== 'string') return undefined;
      let accessor = registry.accessors[prop];
      if (!accessor) {
        accessor = ((_exposed?: unknown): Node | null => {
          return resolveContent(registry.filled[prop]);
        }) as SlotAccessor<any>;
        registry.accessors[prop] = accessor;
      }
      return accessor;
    },
  });
}

type ConsumerSlot = (content?: Node | DocumentFragment | string | null) => Node | null;

function createConsumerBag(registry: SlotRegistry): Record<string, ConsumerSlot> {
  const bag: Record<string, ConsumerSlot> = Object.create(null);
  registry.accessors.default = registry.accessors.default;
  for (const name in registry.accessors) {
    bag[name] = (content?: Node | DocumentFragment | string | null): Node | null => {
      registry.filled[name] = content ?? null;
      return null;
    };
  }
  return bag;
}

function resolveContent(content: unknown): Node | null {
  if (content == null) return null;
  if (content instanceof DocumentFragment) return content.cloneNode(true) as DocumentFragment;
  if (content instanceof Node) return content;
  if (typeof content === 'string') return document.createTextNode(content);
  return null;
}

/**
 * Access a slot inside a component. Must be called inside a `component()` render function.
 */
export function slot<E = void>(name?: string): SlotAccessor<E> {
  const ctx = getCurrentComponent();
  if (!ctx)
    throw new Error(
      'slot() must be called inside a component() render function.\n' +
        '  Example: component("my-el", (props, { default: body }) => body())',
    );

  const slotName = name ?? 'default';

  if (ENABLE_SSR) {
    const ssrSlots = ctx._ssrSlots as Record<string, SSRHtml | undefined> | undefined;
    if (ssrSlots !== undefined) {
      return ((_exposed?: unknown): SSRHtml | null => {
        return ssrSlots[slotName] ?? null;
      }) as unknown as SlotAccessor<E>;
    }
  }

  const children = ctx._slotContent;
  return ((_exposed?: unknown): Node | null => {
    return resolveFromRaw(children, slotName, _exposed);
  }) as SlotAccessor<E>;
}

/**
 * Access the host element's `ElementInternals` inside a `component()` render.
 */
export function internals(): ElementInternals | null {
  return (getCurrentComponent()?._internals as ElementInternals | null | undefined) ?? null;
}

function resolveFromRaw(children: unknown, name: string, exposed: unknown): Node | null {
  const s =
    children != null && typeof children === 'object' && !(children instanceof Node)
      ? (children as Record<string, unknown>)[name]
      : name === 'default'
        ? children
        : null;
  if (typeof s === 'function') {
    const r = (s as (...a: any[]) => unknown)(exposed);
    return r instanceof Node ? r : resolveContent(r);
  }
  return resolveContent(s);
}

export interface RenderOutput {
  view: Node | DocumentFragment;
  expose?: Record<string, unknown>;
}

export type RenderFn<P, S> = (
  props: P,
  slots: { [K in keyof S]: SlotAccessor<S[K]> },
) => Node | DocumentFragment | RenderOutput;

export interface ComponentOptions {
  /** Forward host focus to a focusable descendant in the shadow tree. */
  delegatesFocus?: boolean;
  /** Automatically bridge one native shadow control (requires `@purityjs/core/forms`). */
  formControl?: true | string;
  /** Opt the custom element into form participation (requires `@purityjs/core/forms`). */
  formAssociated?: boolean;
}

function runRender<P, S>(
  renderFn: RenderFn<P, S>,
  props: P,
  slotAccessors: any,
  ctx: ComponentContext,
): { result: Node | DocumentFragment; exposed: Record<string, unknown> } {
  pushContext(ctx);
  let output: Node | DocumentFragment | RenderOutput;
  try {
    try {
      output = renderFn(props, slotAccessors);
    } finally {
      popContext();
    }
  } catch (error) {
    ctx.destroyed = null;
    unmountElementContext(ctx, true);
    throw error;
  }

  if (output && typeof output === 'object' && 'view' in output) {
    const ro = output as RenderOutput;
    return { result: ro.view, exposed: ro.expose ?? {} };
  }
  return { result: output as Node | DocumentFragment, exposed: {} };
}

export interface RegisteredComponentEntry {
  renderFn: RenderFn<Record<string, unknown>, Record<string, unknown>>;
  options: ComponentOptions;
}

const componentRegistry = new Map<string, RegisteredComponentEntry>();
const SAFE_CE_TAG = /^[a-z][\w]*-[\w-]*$/;

/** @internal — accessor used by `@purityjs/ssr` to look up registered components. */
export function _getRegisteredComponent(
  tag: string,
): RenderFn<Record<string, unknown>, Record<string, unknown>> | undefined {
  return componentRegistry.get(tag)?.renderFn;
}

/** @internal — full entry accessor used by `@purityjs/ssr` DSD renderer. */
export function _getRegisteredComponentEntry(tag: string): RegisteredComponentEntry | undefined {
  return componentRegistry.get(tag);
}

/**
 * Define a component as a Custom Element with Shadow DOM.
 */
export function component<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(
  tagName: string,
  renderFn: RenderFn<P, S>,
  options?: ComponentOptions,
): (props: P, children?: any) => Node | DocumentFragment {
  if (!SAFE_CE_TAG.test(tagName)) {
    throw new Error(
      `[Purity] component(): invalid custom element tag name "${tagName}".\n` +
        '  Tag names must start with a lowercase letter, contain a hyphen, ' +
        'and use only letters, digits, hyphens, or underscores (e.g. "p-card").',
    );
  }

  if (
    typeof customElements !== 'undefined' &&
    (options?.formAssociated || options?.formControl) &&
    !formElementSetup
  ) {
    throw new Error(
      '[Purity] Form-associated components require enableFormControls() from @purityjs/core/forms before registration.',
    );
  }

  if (ENABLE_SSR) {
    componentRegistry.set(tagName, {
      renderFn: renderFn as RenderFn<Record<string, unknown>, Record<string, unknown>>,
      options: options ?? {},
    });
  }

  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    const render = renderFn;
    let initFormInstance: ((instance: PurityElementHost) => void) | null = null;

    class PurityElement extends HTMLElement implements PurityElementHost {
      _ctx: ComponentContext | null = null;
      _props: Record<string, unknown> = {};
      _hasRendered = false;
      _hadDeclarativeShadowRoot = false;
      _shadow: ShadowRoot;
      _internals: ElementInternals | null = null;
      declare _formBridge?: { connect(): void; disconnect(): void } | null;

      constructor() {
        super();
        this._hadDeclarativeShadowRoot = this.shadowRoot !== null;
        this._shadow =
          this.shadowRoot ??
          this.attachShadow({
            mode: 'open',
            delegatesFocus: options?.delegatesFocus ?? !!options?.formControl,
          });
        try {
          this._internals = this.attachInternals();
        } catch {
          /* v8 ignore next */
          this._internals = null;
        }
        if (initFormInstance) initFormInstance(this);
      }

      connectedCallback() {
        if (this._isSSRRoot()) return;
        this._renderConnected();
      }

      _isSSRRoot(): boolean {
        return (
          !this._hasRendered && (this._hadDeclarativeShadowRoot || this._shadow.firstChild !== null)
        );
      }

      _hydrateSSR(): void {
        if (!dsdHydrator || !this._isSSRRoot() || !this.isConnected) return;
        try {
          this._renderConnected();
          dsdHydrator.hydrateNestedElements(this._shadow);
        } catch (err) {
          if (this._ctx) unmountElementContext(this._ctx, true, true);
          this._ctx = null;
          this._hasRendered = false;
          this._formBridge?.disconnect();
          throw err;
        }
      }

      _renderConnected(): void {
        const hasDSDContent = this._isSSRRoot();
        const props: Record<string, unknown> = Object.create(null);
        for (const attr of this.attributes) {
          props[attr.name] = attr.value;
        }
        Object.assign(props, this._props);
        for (const key of Object.keys(this)) {
          if (key.startsWith('_')) continue;
          const lower = key.toLowerCase();
          if (lower !== key && !Object.hasOwn(this, lower)) delete props[lower];
          props[key] = (this as any)[key];
        }

        const eventProps: Record<string, unknown> = {};
        for (const key of Object.keys(this)) {
          if (key.startsWith('__purity_event_')) {
            const eventName = key.slice(15);
            eventProps[`on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`] = (
              this as any
            )[key];
          }
        }

        const allProps = { ...props, ...eventProps } as P;
        const registry = createRegistry();
        const slotAccessors = createAccessors(registry);

        if (this.childNodes.length > 0) {
          const frag = document.createDocumentFragment();
          while (this.firstChild) {
            frag.appendChild(this.firstChild);
          }
          registry.filled.default = frag;
        }

        const ctx = new ComponentContext();
        const parentCtx = getCurrentContext();
        if (parentCtx instanceof ComponentContext && !parentCtx._isDestroyed) {
          ctx.parent = parentCtx;
          (parentCtx.children ??= []).push(ctx);
        }
        ctx._shadowRoot = this._shadow;
        ctx._internals = this._internals;
        this._ctx = ctx;

        let result: Node | DocumentFragment | null;
        if (hasDSDContent && dsdHydrator) {
          result = dsdHydrator.hydrateShadow(this._shadow, () =>
            runRender(render, allProps, slotAccessors, ctx),
          );
        } else {
          while (this._shadow.firstChild) this._shadow.removeChild(this._shadow.firstChild);
          result = runRender(render, allProps, slotAccessors, ctx).result;
        }

        if (result !== null) this._shadow.appendChild(result);
        this._formBridge?.connect();

        if (result === null || result instanceof DocumentFragment) {
          ctx.nodes = Array.from(this._shadow.childNodes);
        } else {
          ctx.nodes = [result];
        }

        ctx._isMounted = true;
        this._hasRendered = true;

        scheduleMountCallbacks(ctx);
      }

      /* v8 ignore next 2 */
      connectedMoveCallback() {}

      disconnectedCallback() {
        this._formBridge?.disconnect();
        // Release the disconnected owner before teardown: onDestroy may reconnect.
        const ctx = this._ctx;
        this._ctx = null;
        if (ctx) unmountElementContext(ctx, false, true);
      }
    }

    if ((options?.formAssociated || options?.formControl) && formElementSetup) {
      initFormInstance = formElementSetup(PurityElement, options);
    }

    customElements.define(tagName, PurityElement);
  }

  return (props: P, children?: any) => {
    const ctx = new ComponentContext();
    attachToOwner(ctx, unmountElementContext);

    ctx._slotContent = children;
    const registry = createRegistry();
    const slotAccessors = createAccessors(registry);

    if (children != null && typeof children !== 'function') {
      if (children instanceof Node || typeof children === 'string') {
        registry.filled.default = children;
      } else if (typeof children === 'object') {
        for (const [k, v] of Object.entries(children as Record<string, unknown>)) {
          registry.filled[k] = v;
        }
      }
    }

    if (typeof children === 'function') {
      const { exposed } = runRender(renderFn, props, slotAccessors, ctx);
      const bag = { ...createConsumerBag(registry), ...exposed };
      let consumerResult: unknown;
      try {
        consumerResult = children(bag);
      } catch (error) {
        // The first render may already own reactive effects or nested contexts.
        // A failed consumer must roll back that owner, just like a failed render.
        ctx.destroyed = null;
        unmountElementContext(ctx, true);
        throw error;
      }
      if (consumerResult instanceof Node || typeof consumerResult === 'string') {
        registry.filled.default = consumerResult;
      }
    }

    const { result } = runRender(renderFn, props, slotAccessors, ctx);

    if (result instanceof DocumentFragment) {
      ctx.nodes = Array.from(result.childNodes);
    } else {
      ctx.nodes = [result];
    }

    ctx._isMounted = true;
    scheduleMountCallbacks(ctx);

    return result;
  };
}

/**
 * Render content to a different DOM location. Reactive by default.
 */
export function teleport(
  target: string | Element,
  viewFn: () => Node | DocumentFragment | null,
): Comment {
  const anchor = document.createComment('teleport');
  let currentNodes: Node[] = [];
  let dispose: (() => void) | null = null;
  let disposed = false;
  const clearNodes = () => {
    for (const node of currentNodes) node.parentNode?.removeChild(node);
    currentNodes = [];
  };

  queueMicrotask(() => {
    if (disposed) return;
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      console.error(
        `[Purity] teleport: target "${String(target)}" not found in the DOM.\n` +
          '  Make sure the target element exists before teleport runs.',
      );
      return;
    }
    dispose = watch(() => {
      clearNodes();
      const content = viewFn();
      if (content == null) return;
      currentNodes =
        content instanceof DocumentFragment ? Array.from(content.childNodes) : [content];
      container.appendChild(content);
    });
  });

  const ctx = getCurrentContext();
  if (ctx) {
    (ctx.disposers ??= []).push(() => {
      disposed = true;
      dispose?.();
      clearNodes();
    });
  }

  return anchor;
}
