import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttrType = 'event' | 'bool' | 'prop' | 'bind' | 'reactive-prop' | 'attr';

interface AttrBinding {
  index: number;
  name: string;
  type: AttrType;
}

interface CachedTemplate {
  tpl: HTMLTemplateElement;
  attrBindings: AttrBinding[];
}

interface AttrInfo {
  name: string;
  type: AttrType;
  before: string;
}

// ---------------------------------------------------------------------------
// Template cache
// ---------------------------------------------------------------------------

const templateCache = new WeakMap<TemplateStringsArray, CachedTemplate>();

const MARKER = 'purity-';
const ATTR_MARKER = `__purity_`;

// ---------------------------------------------------------------------------
// html`` — tagged template literal that returns real DOM nodes
// ---------------------------------------------------------------------------

export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment {
  let cached = templateCache.get(strings);

  if (!cached) {
    cached = buildTemplate(strings);
    templateCache.set(strings, cached);
  }

  return hydrate(cached, values);
}

// ---------------------------------------------------------------------------
// buildTemplate
// ---------------------------------------------------------------------------

function buildTemplate(strings: TemplateStringsArray): CachedTemplate {
  let htmlStr = '';
  const attrBindings: AttrBinding[] = [];

  for (let i = 0; i < strings.length; i++) {
    htmlStr += strings[i];

    if (i < strings.length - 1) {
      const attrInfo = detectAttribute(htmlStr);

      if (attrInfo) {
        const markerAttr = `${ATTR_MARKER}${i}`;
        attrBindings.push({
          index: i,
          name: attrInfo.name,
          type: attrInfo.type,
        });
        htmlStr = `${attrInfo.before} ${markerAttr}=""`;
      } else {
        htmlStr += `<!--${MARKER}${i}-->`;
      }
    }
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = htmlStr;

  return { tpl, attrBindings };
}

// ---------------------------------------------------------------------------
// detectAttribute
// ---------------------------------------------------------------------------

function detectAttribute(htmlStr: string): AttrInfo | null {
  const stripped = htmlStr.trimEnd();

  const match = stripped.match(/(?:^|[\s])([.?@:]?[a-zA-Z_][\w.:-]*)=(?:["']?)$/);

  if (!match) return null;

  const fullName = match[1];
  let type: AttrType = 'attr';
  let name = fullName;

  if (fullName.startsWith('@')) {
    type = 'event';
    name = fullName.slice(1);
  } else if (fullName.startsWith('?')) {
    type = 'bool';
    name = fullName.slice(1);
  } else if (fullName.startsWith('.')) {
    type = 'prop';
    name = fullName.slice(1);
  } else if (fullName.startsWith('bind:')) {
    type = 'bind';
    name = fullName.slice(5);
  } else if (fullName.startsWith(':')) {
    type = 'reactive-prop';
    name = fullName.slice(1);
  }

  const attrStart = stripped.lastIndexOf(`${fullName}=`);
  const before = stripped.slice(0, attrStart).trimEnd();

  return { name, type, before };
}

// ---------------------------------------------------------------------------
// hydrate
// ---------------------------------------------------------------------------

function hydrate(cached: CachedTemplate, values: unknown[]): DocumentFragment {
  const { tpl, attrBindings } = cached;
  const fragment = tpl.content.cloneNode(true) as DocumentFragment;

  // --- Process content markers (comment nodes) ---
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT, null);

  const markers: { node: Comment; index: number }[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node as Comment).textContent ?? '';
    if (text.startsWith(MARKER)) {
      const index = parseInt(text.slice(MARKER.length), 10);
      markers.push({ node: node as Comment, index });
    }
  }

  for (const { node: marker, index } of markers) {
    processContentValue(marker, values[index]);
  }

  // --- Process attribute bindings ---
  for (const binding of attrBindings) {
    const markerAttr = `${ATTR_MARKER}${binding.index}`;
    const el = fragment.querySelector(`[${markerAttr}]`);

    if (!el) continue;

    el.removeAttribute(markerAttr);
    processAttributeValue(el as HTMLElement, binding, values[binding.index]);
  }

  return fragment;
}

// ---------------------------------------------------------------------------
// processContentValue
// ---------------------------------------------------------------------------

function processContentValue(marker: Comment, value: unknown): void {
  const parent = marker.parentNode!;

  if (value == null || value === false) {
    parent.removeChild(marker);
    return;
  }

  if (typeof value === 'function') {
    const textNode = document.createTextNode('');
    parent.replaceChild(textNode, marker);

    watch(() => {
      const result = (value as () => unknown)();
      if (result instanceof Node) {
        textNode.replaceWith(result);
      } else {
        textNode.data = result == null ? '' : String(result);
      }
    });
    return;
  }

  if (value instanceof Node) {
    parent.replaceChild(value, marker);
    return;
  }

  if (Array.isArray(value)) {
    const frag = document.createDocumentFragment();
    for (const item of value) {
      if (item instanceof Node) {
        frag.appendChild(item);
      } else {
        frag.appendChild(document.createTextNode(String(item)));
      }
    }
    parent.replaceChild(frag, marker);
    return;
  }

  const textNode = document.createTextNode(String(value));
  parent.replaceChild(textNode, marker);
}

// ---------------------------------------------------------------------------
// processAttributeValue
// ---------------------------------------------------------------------------

function processAttributeValue(el: HTMLElement, binding: AttrBinding, value: unknown): void {
  const { name, type } = binding;

  if (type === 'event') {
    if (typeof value === 'function') {
      // Standard DOM event listener
      el.addEventListener(name, value as EventListener);
      // Also store as property for custom element prop resolution
      // e.g. @saved → __purity_event_saved, component reads it as onSaved
      (el as any)[`__purity_event_${name}`] = value;
    }
    return;
  }

  if (type === 'bool') {
    if (typeof value === 'function') {
      watch(() => {
        if ((value as () => unknown)()) {
          el.setAttribute(name, '');
        } else {
          el.removeAttribute(name);
        }
      });
    } else {
      if (value) {
        el.setAttribute(name, '');
      } else {
        el.removeAttribute(name);
      }
    }
    return;
  }

  if (type === 'bind') {
    // Two-way binding: bind:value=${signal} or bind:checked=${signal}
    // The value must be a StateAccessor (callable getter/setter)
    if (typeof value === 'function') {
      const accessor = value as any;

      // Determine the event and property for this binding
      const propName =
        name === 'group' ? ((el as HTMLInputElement).type === 'radio' ? 'checked' : 'value') : name;
      const eventName = name === 'checked' || name === 'group' ? 'change' : 'input';

      if (name === 'group') {
        // Radio/checkbox group binding
        const inputEl = el as HTMLInputElement;
        if (inputEl.type === 'radio') {
          watch(() => {
            inputEl.checked = accessor() === inputEl.value;
          });
          el.addEventListener('change', () => {
            if (inputEl.checked) accessor(inputEl.value);
          });
        } else {
          // Checkbox group — accessor holds an array
          watch(() => {
            const arr = accessor() as unknown[];
            inputEl.checked = arr.includes(inputEl.value);
          });
          el.addEventListener('change', () => {
            const arr = [...(accessor() as unknown[])];
            if (inputEl.checked) {
              if (!arr.includes(inputEl.value)) arr.push(inputEl.value);
            } else {
              const idx = arr.indexOf(inputEl.value);
              if (idx !== -1) arr.splice(idx, 1);
            }
            accessor(arr);
          });
        }
      } else {
        // Standard property binding (value, checked, etc.)
        watch(() => {
          (el as any)[name] = accessor();
        });

        el.addEventListener(eventName, () => {
          const prop = name === 'checked' ? (el as HTMLInputElement).checked : (el as any)[name];
          accessor(prop);
        });
      }
    }
    return;
  }

  if (type === 'reactive-prop') {
    // :propName=${value} — set as JS property, reactive if function
    // Works on native elements AND custom elements
    // Store in _props for custom element connectedCallback
    if ((el as any)._props) {
      (el as any)._props[name] = value;
    }
    if (typeof value === 'function') {
      watch(() => {
        const v = (value as () => unknown)();
        (el as any)[name] = v;
        if ((el as any)._props) (el as any)._props[name] = v;
      });
    } else {
      (el as any)[name] = value;
    }
    return;
  }

  if (type === 'prop') {
    if (typeof value === 'function') {
      watch(() => {
        (el as any)[name] = (value as () => unknown)();
      });
    } else {
      (el as any)[name] = value;
    }
    return;
  }

  // Regular attribute
  if (typeof value === 'function') {
    watch(() => {
      const v = (value as () => unknown)();
      if (v == null || v === false) {
        el.removeAttribute(name);
      } else {
        el.setAttribute(name, String(v));
      }
    });
  } else {
    if (value == null || value === false) {
      el.removeAttribute(name);
    } else {
      el.setAttribute(name, String(value));
    }
  }
}
