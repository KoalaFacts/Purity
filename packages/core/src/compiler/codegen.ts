// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// ALL templates use cloneNode. Dynamic parts use positional paths
// (firstChild/nextSibling) instead of TreeWalker — zero search overhead.
//
// Static: innerHTML + cloneNode(true) — zero JS per render
// Dynamic: innerHTML with markers + cloneNode + positional path navigation
// ---------------------------------------------------------------------------

import type { ASTNode, AttributeNode, FragmentNode } from './ast.ts';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Tag and attribute names from the parsed AST are spliced into generated JS
// (property accessors, addEventListener / setAttribute string args). The
// regex disallows anything that could escape an identifier or string literal
// — no dots, brackets, quotes, whitespace, or control chars — so spliced
// names cannot inject code. Names are also passed through JSON.stringify at
// every emission site, so the safety is layered.
const SAFE_NAME = /^[a-zA-Z_][\w-]*$/;
function assertSafeName(name: string, kind: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`[Purity] Invalid ${kind} name: "${name}"`);
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// ---------------------------------------------------------------------------
// Positional path: encode the DOM position of each dynamic part
// as a series of firstChild (0) and nextSibling (1) steps from root
// ---------------------------------------------------------------------------

type PathStep = 0 | 1; // 0 = firstChild, 1 = nextSibling

interface ExprSlot {
  type: 'expr';
  index: number;
  path: PathStep[];
  // True when the placeholder at `path` is a Text node (the EXPR_PLACEHOLDER
  // optimization). False when it is a Comment node — needed when the
  // expression has a text or expression sibling, since the HTML parser
  // would coalesce adjacent text nodes and break path navigation.
  textPlaceholder: boolean;
}

interface AttrSlot {
  type: 'attr';
  attrs: AttributeNode[];
  path: PathStep[];
}

type Slot = ExprSlot | AttrSlot;

// ---------------------------------------------------------------------------
// condenseWhitespace — strip whitespace-only text nodes containing a newline
// from anywhere in the tree. These are template formatting artifacts (the
// indentation between sibling tags) that the HTML parser would turn into
// real text nodes when we hand the markup to innerHTML — adding ~5 nodes
// per row in a typical table template (50k extra DOM nodes for 10k rows).
//
// Conservative: we only strip text nodes that (a) trim to empty AND (b)
// contain a newline. A single space without a newline (e.g. `${a} ${b}`)
// is treated as deliberate whitespace and preserved.
//
// Inline-context caveat: between adjacent inline elements written across
// lines (e.g. `<span>a</span>\n<span>b</span>`), removing the indentation
// text removes the rendered space too. Authors who need the space must
// write the elements on one line or use `&nbsp;`. This matches Vue's
// default `whitespace: 'condense'` behavior and Svelte's compiler.
// ---------------------------------------------------------------------------

const PRESERVE_WS_TAGS = new Set(['pre', 'textarea', 'script', 'style']);

function isIndentation(n: ASTNode): boolean {
  return n.type === 'text' && n.value.trim() === '' && n.value.includes('\n');
}

// U+200B ZERO WIDTH SPACE — used as the inline placeholder character for
// reactive `${...}` expressions. The HTML parser turns it into a single Text
// node so we can navigate to it positionally and either keep it (reactive
// text) or replaceWith it (Node / Array values) without an extra
// createTextNode + replaceWith pair.
const EXPR_PLACEHOLDER = '​';

function condenseWhitespace(node: ASTNode): ASTNode {
  if (node.type === 'fragment' || node.type === 'element') {
    if (node.type === 'element' && PRESERVE_WS_TAGS.has(node.tag)) return node;
    let changed = false;
    const next: ASTNode[] = [];
    for (const ch of node.children) {
      if (isIndentation(ch)) {
        changed = true;
        continue;
      }
      const recursed = condenseWhitespace(ch);
      if (recursed !== ch) changed = true;
      next.push(recursed);
    }
    if (!changed) return node;
    return { ...node, children: next } as ASTNode;
  }
  return node;
}

// ---------------------------------------------------------------------------
// generate(ast)
// ---------------------------------------------------------------------------

export function generate(ast: FragmentNode): string {
  // Strip pure-indentation text nodes from the entire tree (not just edges).
  // Indentation between sibling tags becomes real text nodes after innerHTML,
  // multiplying per-item DOM cost in each() — a row template with whitespace
  // between 5 sibling tags adds 5 text nodes per row.
  ast = condenseWhitespace(ast) as FragmentNode;

  if (!hasDynamic(ast)) {
    const html = buildStaticHtml(ast);
    if (!html.trim()) return 'function(){return document.createDocumentFragment();}';
    // Generate DOM API calls instead of innerHTML to prevent code injection
    const stmts: string[] = ["var _t=document.createElement('template');"];
    const counter = { n: 0 };
    genStaticDOM(ast, '_t.content', stmts, counter);
    stmts.push('return function(){return _t.content.cloneNode(true);};');
    return `(function(){${stmts.join('')}})()`;
  }

  // Fast path: simple template (1 element with only text/expression children)
  // Use direct createElement — faster than cloneNode for small templates
  const simple = isSimpleTemplate(ast);
  if (simple) {
    return genSimpleTemplate(simple);
  }

  // Complex template — cloneNode + positional paths
  const slots: Slot[] = [];
  const html = buildDynamicHtml(ast, slots, []);

  const bindCode = genPositionalBindings(slots);

  return [
    '(function(){',
    `var _t=document.createElement('template');`,
    `_t.innerHTML=${JSON.stringify(html)};`,
    'return function(_v,_w){',
    'var _r=_t.content.cloneNode(true);',
    bindCode,
    'return _r;',
    '};',
    '})()',
  ].join('');
}

export function generateModule(ast: FragmentNode): string {
  return `export default ${generate(ast)}`;
}

// ---------------------------------------------------------------------------
// Simple template detection — single element with text/expression children
// e.g. <li>${text}</li>, <span>${a} ${b}</span>, <div class=${cls}>${x}</div>
// ---------------------------------------------------------------------------

interface SimpleTemplate {
  tag: string;
  staticAttrs: { name: string; value: string }[];
  dynamicAttrs: { kind: string; name: string; index: number }[];
  children: ASTNode[]; // text + expression nodes only
}

function isSimpleTemplate(ast: FragmentNode): SimpleTemplate | null {
  if (ast.children.length !== 1) return null;
  const root = ast.children[0];
  if (root.type !== 'element') return null;

  // Check children are only text/expression (no nested elements)
  for (const ch of root.children) {
    if (ch.type !== 'text' && ch.type !== 'expression') return null;
  }

  const staticAttrs: SimpleTemplate['staticAttrs'] = [];
  const dynamicAttrs: SimpleTemplate['dynamicAttrs'] = [];
  for (const a of root.attributes) {
    if (a.kind === 'static') staticAttrs.push({ name: a.name, value: a.value });
    else dynamicAttrs.push({ kind: a.kind, name: a.name, index: a.index });
  }

  return { tag: root.tag, staticAttrs, dynamicAttrs, children: root.children };
}

function genSimpleTemplate(tpl: SimpleTemplate): string {
  assertSafeName(tpl.tag, 'tag');
  const setupParts: string[] = [];
  const reactiveParts: string[] = [];

  setupParts.push(`var _e=document.createElement(${JSON.stringify(tpl.tag)});`);

  // Static attributes
  for (const a of tpl.staticAttrs) {
    if (a.name === 'id' || a.name === 'class') {
      const prop = a.name === 'class' ? 'className' : 'id';
      setupParts.push(`_e.${prop}=${JSON.stringify(a.value)};`);
    } else {
      setupParts.push(
        `_e.setAttribute(${JSON.stringify(a.name)},${JSON.stringify(a.value || '')});`,
      );
    }
  }

  // Dynamic attributes — folded into the shared watch where possible
  for (const a of tpl.dynamicAttrs) {
    assertSafeName(a.name, 'attribute');
    const id = bindVarCounter++;
    const av = `_av${id}`;
    const fl = `_af${id}`;
    const val = `_v[${a.index}]`;
    const qname = JSON.stringify(a.name);
    switch (a.kind) {
      case 'event':
        setupParts.push(`_e.addEventListener(${qname},${val});`);
        break;
      case 'dynamic':
        setupParts.push(
          `var ${av}=${val};var ${fl}=typeof ${av}==='function';`,
          `if(!${fl}&&${av}!=null&&${av}!==false)_e.setAttribute(${qname},String(${av}));`,
        );
        reactiveParts.push(
          `if(${fl}){var v${id}=${av}();if(v${id}==null||v${id}===false)_e.removeAttribute(${qname});else _e.setAttribute(${qname},String(v${id}));}`,
        );
        break;
      case 'bool':
        setupParts.push(
          `var ${av}=${val};var ${fl}=typeof ${av}==='function';`,
          `if(!${fl}&&${av})_e.setAttribute(${qname},'');`,
        );
        reactiveParts.push(
          `if(${fl}){if(${av}())_e.setAttribute(${qname},'');else _e.removeAttribute(${qname});}`,
        );
        break;
      case 'prop':
        setupParts.push(
          `var ${av}=${val};var ${fl}=typeof ${av}==='function';`,
          `if(!${fl})_e[${qname}]=${av};`,
        );
        reactiveParts.push(`if(${fl})_e[${qname}]=${av}();`);
        break;
      case 'reactive-prop':
        setupParts.push(
          `var ${av}=${val};var ${fl}=typeof ${av}==='function';`,
          `if(!${fl})_e[${qname}]=${av};`,
        );
        reactiveParts.push(`if(${fl})_e[${qname}]=${av}();`);
        break;
      case 'bind': {
        // Bind keeps its own watch (asymmetric: signal -> el and listener -> signal).
        const evt = a.name === 'checked' || a.name === 'group' ? 'change' : 'input';
        const qevt = JSON.stringify(evt);
        if (a.name === 'group') {
          setupParts.push(
            `if(typeof ${val}==='function'){if(_e.type==='radio'){_w(function(){_e.checked=${val}()===_e.value;});_e.addEventListener('change',function(){if(_e.checked)${val}(_e.value);});}else{_w(function(){_e.checked=${val}().includes(_e.value);});_e.addEventListener('change',function(){var a=[...${val}()],i=a.indexOf(_e.value);if(_e.checked){if(i===-1)a.push(_e.value);}else if(i!==-1)a.splice(i,1);${val}(a);});}}`,
          );
        } else {
          const readSrc = a.name === 'checked' ? '_e.checked' : `_e[${qname}]`;
          setupParts.push(
            `if(typeof ${val}==='function'){_w(function(){_e[${qname}]=${val}();});_e.addEventListener(${qevt},function(){${val}(${readSrc});});}`,
          );
        }
        break;
      }
    }
  }

  // Children — text nodes + expressions, appended directly.
  // condenseWhitespace already dropped pure-indentation text nodes; anything
  // remaining (content text, single-space separators) is intentional.
  for (const ch of tpl.children) {
    if (ch.type === 'text') {
      if (ch.value !== '') {
        setupParts.push(`_e.appendChild(document.createTextNode(${JSON.stringify(ch.value)}));`);
      }
    } else if (ch.type === 'expression') {
      const val = `_v[${ch.index}]`;
      const id = bindVarCounter++;
      const xv = `_x${id}`;
      const tn = `_t${id}`;
      const fl = `_xf${id}`;
      setupParts.push(
        `var ${xv}=${val};var ${fl}=typeof ${xv}==='function';var ${tn};`,
        `if(${fl}){${tn}=document.createTextNode('');_e.appendChild(${tn});}`,
        `else if(${xv} instanceof Node)_e.appendChild(${xv});`,
        `else if(Array.isArray(${xv})){for(var _ai${id}=0;_ai${id}<${xv}.length;_ai${id}++)_e.appendChild(${xv}[_ai${id}] instanceof Node?${xv}[_ai${id}]:document.createTextNode(String(${xv}[_ai${id}])));}`,
        `else _e.appendChild(document.createTextNode(${xv}==null||${xv}===false?'':String(${xv})));`,
      );
      reactiveParts.push(
        `if(${fl}){var r${id}=${xv}();if(r${id} instanceof Node){${tn}.replaceWith(r${id});${tn}=r${id};}else{if(${tn}.nodeType!==3){var t${id}=document.createTextNode('');${tn}.replaceWith(t${id});${tn}=t${id};}${tn}.data=r${id}==null?'':String(r${id});}}`,
      );
    }
  }

  let body = setupParts.join('');
  if (reactiveParts.length > 0) {
    body += `_w(function(){${reactiveParts.join('')}});`;
  }
  body += 'return _e;';
  return `function(_v,_w){${body}}`;
}

// ---------------------------------------------------------------------------
// hasDynamic
// ---------------------------------------------------------------------------

function hasDynamic(node: ASTNode): boolean {
  if (node.type === 'expression') return true;
  if (node.type === 'element') {
    if (node.attributes.some((a) => a.kind !== 'static')) return true;
    return node.children.some(hasDynamic);
  }
  if (node.type === 'fragment') return node.children.some(hasDynamic);
  return false;
}

// ---------------------------------------------------------------------------
// buildStaticHtml (no markers)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// genStaticDOM — generate DOM API calls for static templates (no innerHTML)
// ---------------------------------------------------------------------------

function genStaticDOM(
  node: ASTNode,
  parent: string,
  stmts: string[],
  counter: { n: number },
): void {
  switch (node.type) {
    case 'text': {
      const id = `_n${counter.n++}`;
      stmts.push(
        `var ${id}=document.createTextNode(${JSON.stringify(node.value)});${parent}.appendChild(${id});`,
      );
      break;
    }
    case 'comment': {
      const id = `_n${counter.n++}`;
      stmts.push(
        `var ${id}=document.createComment(${JSON.stringify(node.value)});${parent}.appendChild(${id});`,
      );
      break;
    }
    case 'element': {
      assertSafeName(node.tag, 'tag');
      const id = `_n${counter.n++}`;
      stmts.push(`var ${id}=document.createElement(${JSON.stringify(node.tag)});`);
      for (const a of node.attributes) {
        if (a.kind === 'static') {
          stmts.push(
            a.value
              ? `${id}.setAttribute(${JSON.stringify(a.name)},${JSON.stringify(a.value)});`
              : `${id}.setAttribute(${JSON.stringify(a.name)},'');`,
          );
        }
      }
      for (const ch of node.children) {
        genStaticDOM(ch, id, stmts, counter);
      }
      stmts.push(`${parent}.appendChild(${id});`);
      break;
    }
    case 'fragment': {
      for (const ch of node.children) {
        genStaticDOM(ch, parent, stmts, counter);
      }
      break;
    }
  }
}

function buildStaticHtml(node: ASTNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'comment':
      return `<!--${node.value.replace(/--!?>/g, '--&gt;')}-->`;
    case 'element': {
      assertSafeName(node.tag, 'tag');
      let s = `<${node.tag}`;
      for (const a of node.attributes) {
        if (a.kind === 'static')
          s += a.value ? ` ${a.name}="${escapeAttr(a.value)}"` : ` ${a.name}`;
      }
      if (VOID.has(node.tag)) return `${s}/>`;
      s += '>';
      for (const ch of node.children) s += buildStaticHtml(ch);
      return `${s}</${node.tag}>`;
    }
    case 'fragment':
      return node.children.map(buildStaticHtml).join('');
    default:
      /* v8 ignore next -- defensive fallthrough; AST has no other types */
      return '';
  }
}

// ---------------------------------------------------------------------------
// buildDynamicHtml — build HTML + record positional paths for each slot
//
// currentPath tracks the position of the current node relative to root.
// Each child increments via nextSibling, entering a child uses firstChild.
// ---------------------------------------------------------------------------

// useTextPlaceholder is decided by the parent (element/fragment) based on the
// expression's siblings. False forces a `<!---->` comment so the HTML parser
// won't merge an adjacent text node into the placeholder.
function buildDynamicHtml(
  node: ASTNode,
  slots: Slot[],
  currentPath: PathStep[],
  useTextPlaceholder: boolean = true,
): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'comment':
      return `<!--${node.value.replace(/--!?>/g, '--&gt;')}-->`;

    case 'expression': {
      slots.push({
        type: 'expr',
        index: node.index,
        path: [...currentPath],
        textPlaceholder: useTextPlaceholder,
      });
      return useTextPlaceholder ? EXPR_PLACEHOLDER : '<!---->';
    }

    case 'element': {
      assertSafeName(node.tag, 'tag');
      let s = `<${node.tag}`;

      const dynamicAttrs: AttributeNode[] = [];
      for (const a of node.attributes) {
        if (a.kind === 'static') {
          s += a.value ? ` ${a.name}="${escapeAttr(a.value)}"` : ` ${a.name}`;
        } else {
          dynamicAttrs.push(a);
        }
      }

      if (dynamicAttrs.length > 0) {
        slots.push({ type: 'attr', attrs: dynamicAttrs, path: [...currentPath] });
      }

      if (VOID.has(node.tag)) return `${s}/>`;
      s += '>';
      s += emitChildrenHtml(node.children, slots, currentPath);
      return `${s}</${node.tag}>`;
    }

    case 'fragment':
      return emitChildrenHtml(node.children, slots, currentPath);

    default:
      /* v8 ignore next -- defensive fallthrough; AST has no other types */
      return '';
  }
}

// Emit children of an element or fragment, deciding per-child whether an
// expression can use the cheap text-node placeholder. An expression that
// touches a text or expression sibling must use a comment placeholder so the
// DOM parser doesn't coalesce adjacent text nodes and shift our path
// navigation.
function emitChildrenHtml(children: ASTNode[], slots: Slot[], currentPath: PathStep[]): string {
  let s = '';
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    let useTextPlaceholder = true;
    if (ch.type === 'expression') {
      const prev = children[i - 1];
      const next = children[i + 1];
      if (prev && (prev.type === 'text' || prev.type === 'expression')) useTextPlaceholder = false;
      if (next && (next.type === 'text' || next.type === 'expression')) useTextPlaceholder = false;
    }
    s += buildDynamicHtml(ch, slots, childPathFromParent(currentPath, i), useTextPlaceholder);
  }
  return s;
}

// Path to the i-th child of a parent: firstChild + (i-1) nextSiblings
function childPathFromParent(parentPath: PathStep[], childIndex: number): PathStep[] {
  const path = [...parentPath, 0 as PathStep]; // firstChild
  for (let i = 0; i < childIndex; i++) {
    path.push(1 as PathStep); // nextSibling for each step
  }
  return path;
}

// ---------------------------------------------------------------------------
// genPositionalBindings — navigate to each slot via firstChild/nextSibling
// No TreeWalker, no querySelector, no switch/case — just direct path walk.
//
// Reactive bindings within the same template instance are folded into a
// single _w() call. With N reactive bindings (typical row template: 3-5),
// this collapses N Computed allocations + N observer registrations into
// one. A typical 10k-row table goes from ~50k watches to ~10k watches at
// instantiation time.
//
// Tradeoff: when a downstream signal changes, the body of the shared watch
// re-runs all reactive lines (gated by per-line `_f*` booleans frozen at
// setup), so unchanged bindings still execute their assignment. Text-node
// writes are ~50ns; this overhead is dwarfed by the watch-creation savings.
// ---------------------------------------------------------------------------

let bindVarCounter = 0;

interface BindingParts {
  setup: string; // synchronous code: typeof checks, text-node creation, static assignments
  reactive: string; // body for the shared watch — guarded by per-binding _f* flags
}

function genPositionalBindings(slots: Slot[]): string {
  const setupParts: string[] = [];
  const reactiveParts: string[] = [];

  for (const slot of slots) {
    const nodeVar = `_n${bindVarCounter++}`;

    // Generate path navigation: _r.firstChild.nextSibling.firstChild...
    let nav = '_r';
    for (const step of slot.path) {
      nav += step === 0 ? '.firstChild' : '.nextSibling';
    }
    setupParts.push(`var ${nodeVar}=${nav};`);

    if (slot.type === 'expr') {
      const { setup, reactive } = genExprBinding(nodeVar, slot.index, slot.textPlaceholder);
      setupParts.push(setup);
      if (reactive) reactiveParts.push(reactive);
    } else {
      for (const attr of slot.attrs) {
        if (attr.kind !== 'static') {
          const { setup, reactive } = genAttrBinding(nodeVar, attr);
          setupParts.push(setup);
          if (reactive) reactiveParts.push(reactive);
        }
      }
    }
  }

  let result = setupParts.join('');
  if (reactiveParts.length > 0) {
    result += `_w(function(){${reactiveParts.join('')}});`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Expression binding — substitute the placeholder with dynamic content.
//
// When `textPlaceholder` is true the slot is already a Text node (the
// EXPR_PLACEHOLDER zero-width space) so the reactive-text case can keep it
// in place and just write .data — saves a createTextNode + replaceWith per
// expression vs the comment-placeholder path. When false (expression has a
// text/expression sibling that would coalesce in the parser), we keep the
// old comment-placeholder behavior.
// ---------------------------------------------------------------------------

function genExprBinding(slotVar: string, index: number, textPlaceholder: boolean): BindingParts {
  const id = bindVarCounter++;
  const xv = `_xv${id}`;
  const tn = `_tn${id}`;
  const fl = `_f${id}`;
  const val = `_v[${index}]`;

  let setup: string;
  if (textPlaceholder) {
    // Slot is a Text node already. Reactive case: keep it, watch writes .data.
    // Static cases: write .data in place, or replaceWith for Node / Array.
    setup = [
      `var ${xv}=${val};`,
      `var ${fl}=typeof ${xv}==='function';`,
      `var ${tn}=${slotVar};`,
      `if(!${fl}){`,
      `if(typeof ${xv}==='object'){`,
      `if(${xv} instanceof DocumentFragment||${xv} instanceof Node){${slotVar}.replaceWith(${xv});${tn}=${xv};}`,
      `else if(Array.isArray(${xv})){var _af${id}=document.createDocumentFragment();for(var _ai${id}=0;_ai${id}<${xv}.length;_ai${id}++)_af${id}.appendChild(${xv}[_ai${id}] instanceof Node?${xv}[_ai${id}]:document.createTextNode(String(${xv}[_ai${id}])));${slotVar}.replaceWith(_af${id});}`,
      `else{${slotVar}.data=${xv}==null||${xv}===false?'':String(${xv});}`,
      `}else{${slotVar}.data=${xv}==null||${xv}===false?'':String(${xv});}`,
      `}`,
    ].join('');
  } else {
    // Slot is a Comment placeholder. Replace with a fresh text node up front
    // so the reactive watch can mutate `.data` directly afterwards.
    setup = [
      `var ${xv}=${val};`,
      `var ${fl}=typeof ${xv}==='function';`,
      `var ${tn};`,
      `if(${fl}){`,
      `${tn}=document.createTextNode('');${slotVar}.replaceWith(${tn});`,
      `}else if(typeof ${xv}==='object'){`,
      `if(${xv} instanceof DocumentFragment||${xv} instanceof Node){${slotVar}.replaceWith(${xv});}`,
      `else if(Array.isArray(${xv})){var _af${id}=document.createDocumentFragment();for(var _ai${id}=0;_ai${id}<${xv}.length;_ai${id}++)_af${id}.appendChild(${xv}[_ai${id}] instanceof Node?${xv}[_ai${id}]:document.createTextNode(String(${xv}[_ai${id}])));${slotVar}.replaceWith(_af${id});}`,
      `else{${slotVar}.replaceWith(document.createTextNode(${xv}==null||${xv}===false?'':String(${xv})));}`,
      `}else{${slotVar}.replaceWith(document.createTextNode(${xv}==null||${xv}===false?'':String(${xv})));}`,
    ].join('');
  }

  const reactive = [
    `if(${fl}){`,
    `var r${id}=${xv}();`,
    `if(r${id} instanceof Node){${tn}.replaceWith(r${id});${tn}=r${id};}`,
    `else{if(${tn}.nodeType!==3){var t${id}=document.createTextNode('');${tn}.replaceWith(t${id});${tn}=t${id};}${tn}.data=r${id}==null?'':String(r${id});}`,
    `}`,
  ].join('');

  return { setup, reactive };
}

// ---------------------------------------------------------------------------
// Attribute binding (complex template path).
// Returns { setup, reactive }: same fold contract as genExprBinding.
// ---------------------------------------------------------------------------

function genAttrBinding(el: string, attr: AttributeNode): BindingParts {
  if (attr.kind === 'static') return { setup: '', reactive: '' };
  assertSafeName(attr.name, 'attribute');

  const id = bindVarCounter++;
  const av = `_av${id}`;
  const fl = `_af${id}`;
  const val = `_v[${attr.index}]`;
  const qname = JSON.stringify(attr.name);

  switch (attr.kind) {
    case 'event':
      return { setup: `${el}.addEventListener(${qname},${val});`, reactive: '' };

    case 'dynamic': {
      const setup = [
        `var ${av}=${val};`,
        `var ${fl}=typeof ${av}==='function';`,
        `if(!${fl}&&${av}!=null&&${av}!==false)${el}.setAttribute(${qname},String(${av}));`,
      ].join('');
      const reactive = [
        `if(${fl}){`,
        `var v${id}=${av}();`,
        `if(v${id}==null||v${id}===false)${el}.removeAttribute(${qname});`,
        `else ${el}.setAttribute(${qname},String(v${id}));`,
        `}`,
      ].join('');
      return { setup, reactive };
    }

    case 'bool': {
      const setup = [
        `var ${av}=${val};`,
        `var ${fl}=typeof ${av}==='function';`,
        `if(!${fl}&&${av})${el}.setAttribute(${qname},'');`,
      ].join('');
      const reactive = [
        `if(${fl}){`,
        `if(${av}())${el}.setAttribute(${qname},'');`,
        `else ${el}.removeAttribute(${qname});`,
        `}`,
      ].join('');
      return { setup, reactive };
    }

    case 'prop': {
      const setup = [
        `var ${av}=${val};`,
        `var ${fl}=typeof ${av}==='function';`,
        `if(!${fl})${el}[${qname}]=${av};`,
      ].join('');
      const reactive = `if(${fl})${el}[${qname}]=${av}();`;
      return { setup, reactive };
    }

    case 'reactive-prop': {
      const setup = [
        `var ${av}=${val};`,
        `var ${fl}=typeof ${av}==='function';`,
        `if(!${fl})${el}[${qname}]=${av};`,
      ].join('');
      const reactive = `if(${fl})${el}[${qname}]=${av}();`;
      return { setup, reactive };
    }

    case 'bind': {
      // Bind keeps its own watch — its reactive read is asymmetric (signal ->
      // element) AND it installs an event listener that writes the signal.
      // The setup includes both. Folding doesn't help here because the
      // listener is per-input.
      const evt = attr.name === 'checked' || attr.name === 'group' ? 'change' : 'input';
      const qevt = JSON.stringify(evt);
      if (attr.name === 'group') {
        return {
          setup: [
            `if(typeof ${val}==='function'){`,
            `if(${el}.type==='radio'){_w(function(){${el}.checked=${val}()===${el}.value;});${el}.addEventListener('change',function(){if(${el}.checked)${val}(${el}.value);});}`,
            `else{_w(function(){${el}.checked=${val}().includes(${el}.value);});${el}.addEventListener('change',function(){var a=[...${val}()],i=a.indexOf(${el}.value);if(${el}.checked){if(i===-1)a.push(${el}.value);}else if(i!==-1)a.splice(i,1);${val}(a);});}}`,
          ].join(''),
          reactive: '',
        };
      }
      const readSrc = attr.name === 'checked' ? `${el}.checked` : `${el}[${qname}]`;
      return {
        setup: `if(typeof ${val}==='function'){_w(function(){${el}[${qname}]=${val}();});${el}.addEventListener(${qevt},function(){${val}(${readSrc});});}`,
        reactive: '',
      };
    }

    default:
      /* v8 ignore next -- defensive fallthrough; parser only emits known kinds */
      return { setup: '', reactive: '' };
  }
}
