import { effect } from './signals.js';

// ---------------------------------------------------------------------------
// Template cache — keyed by the TemplateStringsArray identity so the same
// tagged-template call site reuses its parsed <template> element.
// ---------------------------------------------------------------------------

const templateCache = new WeakMap();

// Marker prefix used in comment nodes to identify dynamic slots.
const MARKER = 'purity-';

// Attribute marker for dynamic attribute bindings.
const ATTR_MARKER = `__purity_`;

// ---------------------------------------------------------------------------
// html`` — tagged template literal that returns real DOM nodes
//
// Usage:
//   html`<p>Hello ${name}</p>`                     // static value
//   html`<p>${() => count()}</p>`                  // reactive binding
//   html`<button @click=${handler}>Click</button>` // event binding
//   html`<div class=${() => cls()}>...</div>`      // reactive attribute
//   html`<input ?disabled=${() => off()} />`       // boolean attribute
//   html`<div .textContent=${val}>...</div>`        // property binding
// ---------------------------------------------------------------------------

export function html(strings, ...values) {
  // 1. Get or create the cached template for this call site
  let cached = templateCache.get(strings);

  if (!cached) {
    cached = buildTemplate(strings);
    templateCache.set(strings, cached);
  }

  // 2. Clone the template and hydrate with values
  return hydrate(cached, values);
}

// ---------------------------------------------------------------------------
// buildTemplate — parse the static parts into a <template> with markers
// ---------------------------------------------------------------------------

function buildTemplate(strings) {
  let htmlStr = '';
  const attrBindings = []; // { index, name, type } for attribute-position values

  for (let i = 0; i < strings.length; i++) {
    htmlStr += strings[i];

    if (i < strings.length - 1) {
      // Detect if this expression is inside an attribute
      const attrInfo = detectAttribute(htmlStr);

      if (attrInfo) {
        // This value is inside an attribute — use a sentinel attribute value
        // that we can find later via querySelectorAll.
        const markerAttr = `${ATTR_MARKER}${i}`;
        attrBindings.push({
          index: i,
          name: attrInfo.name,
          type: attrInfo.type, // 'event' | 'bool' | 'prop' | 'attr'
        });

        // Replace the attribute in the HTML with a marker data attribute.
        // Remove the partial attribute (name="...value-so-far) and add marker.
        htmlStr = attrInfo.before + ` ${markerAttr}=""`;
      } else {
        // Content position — insert a comment marker
        htmlStr += `<!--${MARKER}${i}-->`;
      }
    }
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = htmlStr;

  return { tpl, attrBindings };
}

// ---------------------------------------------------------------------------
// detectAttribute — check if the current position in HTML is inside an
// attribute value. Returns { name, type, before } or null.
//
// We look backwards from the end of `html` for an unclosed attribute pattern:
//   name="...   or   @event=${   or   ?bool=${   or   .prop=${
// ---------------------------------------------------------------------------

function detectAttribute(htmlStr) {
  // Walk backwards to find if we're inside an attribute value or at attr=
  // Pattern: we just wrote `attrName=` or `attrName="` or `attrName='`
  const stripped = htmlStr.trimEnd();

  // Match patterns like: name=, name=", name='
  // Also handle @event=, ?bool=, .prop=
  const match = stripped.match(
    /(?:^|[\s])([.?@]?[a-zA-Z_][\w.-]*)=(?:["']?)$/
  );

  if (!match) return null;

  const fullName = match[1];
  let type = 'attr';
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
  }

  // `before` is the HTML up to (but not including) the attribute assignment
  const attrStart = stripped.lastIndexOf(fullName + '=');
  const before = stripped.slice(0, attrStart).trimEnd();

  return { name, type, before };
}

// ---------------------------------------------------------------------------
// hydrate — clone the template, find markers, and bind values
// ---------------------------------------------------------------------------

function hydrate(cached, values) {
  const { tpl, attrBindings } = cached;
  const fragment = tpl.content.cloneNode(true);

  // --- Process content markers (comment nodes) ---
  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_COMMENT,
    null
  );

  const markers = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent;
    if (text.startsWith(MARKER)) {
      const index = parseInt(text.slice(MARKER.length), 10);
      markers.push({ node, index });
    }
  }

  for (const { node: marker, index } of markers) {
    const value = values[index];
    processContentValue(marker, value);
  }

  // --- Process attribute bindings ---
  for (const binding of attrBindings) {
    const markerAttr = `${ATTR_MARKER}${binding.index}`;
    const el = fragment.querySelector(`[${markerAttr}]`);

    if (!el) continue;

    el.removeAttribute(markerAttr);
    const value = values[binding.index];

    processAttributeValue(el, binding, value);
  }

  return fragment;
}

// ---------------------------------------------------------------------------
// processContentValue — replace a comment marker with the appropriate DOM
// ---------------------------------------------------------------------------

function processContentValue(marker, value) {
  const parent = marker.parentNode;

  if (value == null || value === false) {
    // Render nothing — just remove the marker
    parent.removeChild(marker);
    return;
  }

  if (typeof value === 'function') {
    // Reactive binding — create a text node and effect to update it
    const textNode = document.createTextNode('');
    parent.replaceChild(textNode, marker);

    effect(() => {
      const result = value();
      if (result instanceof Node) {
        // If the function returns a DOM node, replace the text node
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

  // Primitive — string / number
  const textNode = document.createTextNode(String(value));
  parent.replaceChild(textNode, marker);
}

// ---------------------------------------------------------------------------
// processAttributeValue — bind a value to an element attribute / property
// ---------------------------------------------------------------------------

function processAttributeValue(el, binding, value) {
  const { name, type } = binding;

  if (type === 'event') {
    // @click=${handler}  →  addEventListener('click', handler)
    if (typeof value === 'function') {
      el.addEventListener(name, value);
    }
    return;
  }

  if (type === 'bool') {
    // ?disabled=${bool}  →  toggle attribute
    if (typeof value === 'function') {
      effect(() => {
        if (value()) {
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

  if (type === 'prop') {
    // .textContent=${val}  →  el.textContent = val
    if (typeof value === 'function') {
      effect(() => {
        el[name] = value();
      });
    } else {
      el[name] = value;
    }
    return;
  }

  // Regular attribute
  if (typeof value === 'function') {
    effect(() => {
      const v = value();
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
