import { ComponentContext, disposeScope, popContext, pushContext } from '@purityjs/signals';
import {
  _getRegisteredComponentEntry,
  setSSRControls,
  setSSRMarkup,
  setSSRResources,
} from '@purityjs/core/ssr-bridge';
import { ssrControlFlow } from './control.ts';
import { ssrResourceFlow } from './resource.ts';
import {
  escAttr,
  escHtml,
  markSSRHtml,
  setSSRComponentRenderer,
  valueToAttr,
  valueToHtml,
  type SSRComponentRenderer,
  type SSRHtml,
} from './runtime.ts';

const SAFE_CE_TAG = /^[a-z][\w]*-[\w-]*$/;
const SAFE_ATTR_NAME = /^[a-zA-Z_][\w-]*$/;

const renderComponent: SSRComponentRenderer = (
  tag,
  attrs,
  slotHtml,
  slotSpans,
  spans,
  offset = 0,
) => {
  const entry = _getRegisteredComponentEntry(tag);
  if (!entry || !SAFE_CE_TAG.test(tag)) return null;

  const props: Record<string, unknown> = {};
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    props[key] = typeof value === 'function' ? (value as () => unknown)() : value;
  }

  const ctx = new ComponentContext();
  const serverContext = ctx as ComponentContext & {
    _ssrStyles: string[];
    _ssrSlots: Record<string, SSRHtml | undefined>;
  };
  serverContext._ssrStyles = [];
  const slotValue = markSSRHtml(slotHtml, slotSpans);
  serverContext._ssrSlots = { default: slotValue };
  const slots = new Proxy({} as Record<string, () => SSRHtml | null>, {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      return () => serverContext._ssrSlots[name] ?? null;
    },
  });

  pushContext(ctx);
  let view: unknown;
  try {
    view = entry.renderFn(props, slots as unknown as Parameters<typeof entry.renderFn>[1]);
  } catch (error) {
    disposeScope(ctx);
    throw error;
  } finally {
    popContext();
  }

  try {
    const renderedHtml = valueToHtml(view);
    let hostAttrs = '';
    for (const key of Object.keys(props)) {
      if (!SAFE_ATTR_NAME.test(key)) continue;
      const value = props[key];
      if (value !== null && (typeof value === 'object' || typeof value === 'function')) continue;
      const attr = valueToAttr(value);
      if (attr !== null) hostAttrs += attr === '' ? ` ${key}` : ` ${key}="${attr}"`;
    }
    const styles = serverContext._ssrStyles;
    const styleBlock = styles.length
      ? `<style>${styles.join('\n').replace(/<\/style/gi, '<\\/style')}</style>`
      : '';
    const focus =
      (entry.options.delegatesFocus ?? !!entry.options.formControl)
        ? ' shadowrootdelegatesfocus'
        : '';
    const markup = `<${tag}${hostAttrs}><template shadowrootmode="open"${focus}>${styleBlock}${renderedHtml}</template></${tag}>`;
    spans?.push([offset, offset + markup.length, slotHtml, slotSpans ?? []]);
    return markup;
  } finally {
    disposeScope(ctx);
  }
};

// Installation is tied to rendering so bundlers cannot discard it as an
// unreferenced module side effect.
export function ensureSSRComponentRendererInstalled(): void {
  setSSRControls(ssrControlFlow);
  setSSRResources(ssrResourceFlow);
  setSSRMarkup({ escAttr, escHtml, markSSRHtml, valueToHtml });
  setSSRComponentRenderer(renderComponent);
}
