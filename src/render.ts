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
// Template cache + constants
// ---------------------------------------------------------------------------

const templateCache = new WeakMap<TemplateStringsArray, CachedTemplate>();
const MARKER = 'purity-';
const MARKER_LEN = MARKER.length;
const ATTR_MARKER = '__purity_';

// Pre-compiled regex — avoids re-compilation on every detectAttribute call
const ATTR_RE = /(?:^|[\s])([.?@:]?[a-zA-Z_][\w.:-]*)=["']?$/;

// ---------------------------------------------------------------------------
// html``
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
// buildTemplate — parse static parts into <template> with markers
// Perf: regex is pre-compiled, only the tail of htmlStr is tested
// ---------------------------------------------------------------------------

function buildTemplate(strings: TemplateStringsArray): CachedTemplate {
  let htmlStr = '';
  const attrBindings: AttrBinding[] = [];

  for (let i = 0; i < strings.length; i++) {
    htmlStr += strings[i];

    if (i < strings.length - 1) {
      const attrInfo = detectAttribute(htmlStr);

      if (attrInfo) {
        attrBindings.push({ index: i, name: attrInfo.name, type: attrInfo.type });
        htmlStr = `${attrInfo.before} ${ATTR_MARKER}${i}=""`;
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
// detectAttribute — check if current position is inside an attribute
// Perf: uses pre-compiled regex, only tests the trimmed tail
// ---------------------------------------------------------------------------

function detectAttribute(htmlStr: string): AttrInfo | null {
  // Only check the last ~100 chars — attribute names are short
  const tail = htmlStr.length > 100 ? htmlStr.slice(-100) : htmlStr;
  const stripped = tail.trimEnd();
  const match = ATTR_RE.exec(stripped);

  if (!match) return null;

  const fullName = match[1];
  let type: AttrType = 'attr';
  let name = fullName;
  const ch = fullName.charCodeAt(0);

  // Fast prefix dispatch by char code
  if (ch === 64) {
    // '@'
    type = 'event';
    name = fullName.slice(1);
  } else if (ch === 63) {
    // '?'
    type = 'bool';
    name = fullName.slice(1);
  } else if (ch === 46) {
    // '.'
    type = 'prop';
    name = fullName.slice(1);
  } else if (ch === 58) {
    // ':'
    type = 'reactive-prop';
    name = fullName.slice(1);
  } else if (fullName.charCodeAt(0) === 98 && fullName.startsWith('bind:')) {
    // 'b' + 'ind:'
    type = 'bind';
    name = fullName.slice(5);
  }

  // Compute 'before' from the full htmlStr, not the tail
  const attrStart = htmlStr.trimEnd().lastIndexOf(`${fullName}=`);
  const before = htmlStr.slice(0, attrStart).trimEnd();

  return { name, type, before };
}

// ---------------------------------------------------------------------------
// hydrate — clone template, process markers and bindings in minimal passes
// ---------------------------------------------------------------------------

function hydrate(cached: CachedTemplate, values: unknown[]): DocumentFragment {
  const { tpl, attrBindings } = cached;
  const fragment = tpl.content.cloneNode(true) as DocumentFragment;

  // --- Single TreeWalker pass for comment markers + attribute elements ---
  if (attrBindings.length > 0 || true) {
    // Process comments directly during walk — no intermediate array
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT, null);
    // Collect markers first (can't modify DOM during walk)
    let node: Node | null;
    let markerCount = 0;
    // Use a flat array [node, index, node, index, ...] to avoid object allocation
    const markerNodes: (Comment | number)[] = [];

    while ((node = walker.nextNode())) {
      const text = (node as Comment).textContent ?? '';
      if (text.charCodeAt(0) === 112 && text.startsWith(MARKER)) {
        // 'p' = first char of 'purity-'
        markerNodes.push(node as Comment, parseInt(text.slice(MARKER_LEN), 10));
        markerCount++;
      }
    }

    for (let i = 0; i < markerCount; i++) {
      const marker = markerNodes[i * 2] as Comment;
      const index = markerNodes[i * 2 + 1] as number;
      processContentValue(marker, values[index]);
    }
  }

  // --- Process attribute bindings via querySelectorAll in one call ---
  if (attrBindings.length > 0) {
    // Build a single selector for all bindings
    const selector = attrBindings.map((b) => `[${ATTR_MARKER}${b.index}]`).join(',');
    const elements = fragment.querySelectorAll(selector);

    // Build a map of marker attr → binding for O(1) lookup
    const bindingMap = new Map<string, AttrBinding>();
    for (const b of attrBindings) {
      bindingMap.set(`${ATTR_MARKER}${b.index}`, b);
    }

    for (const el of elements) {
      // Find which binding this element matches
      for (const [attr, binding] of bindingMap) {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr);
          processAttributeValue(el as HTMLElement, binding, values[binding.index]);
          bindingMap.delete(attr); // Each marker is unique, remove after match
          break;
        }
      }
    }
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
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      frag.appendChild(item instanceof Node ? item : document.createTextNode(String(item)));
    }
    parent.replaceChild(frag, marker);
    return;
  }

  parent.replaceChild(document.createTextNode(String(value)), marker);
}

// ---------------------------------------------------------------------------
// processAttributeValue
// ---------------------------------------------------------------------------

function processAttributeValue(el: HTMLElement, binding: AttrBinding, value: unknown): void {
  const { name, type } = binding;

  if (type === 'event') {
    if (typeof value === 'function') {
      el.addEventListener(name, value as EventListener);
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
    } else if (value) {
      el.setAttribute(name, '');
    } else {
      el.removeAttribute(name);
    }
    return;
  }

  if (type === 'bind') {
    if (typeof value === 'function') {
      const accessor = value as any;
      const eventName = name === 'checked' || name === 'group' ? 'change' : 'input';

      if (name === 'group') {
        const inputEl = el as HTMLInputElement;
        if (inputEl.type === 'radio') {
          watch(() => {
            inputEl.checked = accessor() === inputEl.value;
          });
          el.addEventListener('change', () => {
            if (inputEl.checked) accessor(inputEl.value);
          });
        } else {
          watch(() => {
            inputEl.checked = (accessor() as unknown[]).includes(inputEl.value);
          });
          el.addEventListener('change', () => {
            const arr = [...(accessor() as unknown[])];
            const idx = arr.indexOf(inputEl.value);
            if (inputEl.checked) {
              if (idx === -1) arr.push(inputEl.value);
            } else if (idx !== -1) {
              arr.splice(idx, 1);
            }
            accessor(arr);
          });
        }
      } else {
        watch(() => {
          (el as any)[name] = accessor();
        });
        el.addEventListener(eventName, () => {
          accessor(name === 'checked' ? (el as HTMLInputElement).checked : (el as any)[name]);
        });
      }
    }
    return;
  }

  if (type === 'reactive-prop') {
    if ((el as any)._props) (el as any)._props[name] = value;
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
  } else if (value == null || value === false) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, String(value));
  }
}
