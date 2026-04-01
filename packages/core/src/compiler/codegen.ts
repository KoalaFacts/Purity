// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// ALL templates use cloneNode. Dynamic parts use positional paths
// (firstChild/nextSibling) instead of TreeWalker — zero search overhead.
//
// Static: innerHTML + cloneNode(true) — zero JS per render
// Dynamic: innerHTML with markers + cloneNode + positional path navigation
// ---------------------------------------------------------------------------

import type { ASTNode, AttributeNode, FragmentNode } from './ast.js';

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

const SAFE_NAME = /^[a-zA-Z_][\w.-]*$/;
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
}

interface AttrSlot {
  type: 'attr';
  attrs: AttributeNode[];
  path: PathStep[];
}

type Slot = ExprSlot | AttrSlot;

// ---------------------------------------------------------------------------
// generate(ast)
// ---------------------------------------------------------------------------

export function generate(ast: FragmentNode): string {
  if (!hasDynamic(ast)) {
    const html = buildStaticHtml(ast);
    if (!html.trim()) return 'function(){return document.createDocumentFragment();}';
    return `(function(){var _t=document.createElement('template');_t.innerHTML=${JSON.stringify(html)};return function(){return _t.content.cloneNode(true);};})()`;
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
  const lines: string[] = [];

  lines.push(`var _e=document.createElement('${tpl.tag}');`);

  // Static attributes
  for (const a of tpl.staticAttrs) {
    if (a.name === 'id' || a.name === 'class') {
      lines.push(`_e.${a.name === 'class' ? 'className' : a.name}=${JSON.stringify(a.value)};`);
    } else {
      lines.push(`_e.setAttribute('${a.name}',${JSON.stringify(a.value || '')});`);
    }
  }

  // Dynamic attributes
  for (const a of tpl.dynamicAttrs) {
    assertSafeName(a.name, 'attribute');
    const val = `_v[${a.index}]`;
    switch (a.kind) {
      case 'event':
        lines.push(`_e.addEventListener('${a.name}',${val});`);
        break;
      case 'dynamic':
        lines.push(
          `if(typeof ${val}==='function')_w(function(){var v=${val}();if(v==null||v===false)_e.removeAttribute('${a.name}');else _e.setAttribute('${a.name}',String(v));});else if(${val}!=null&&${val}!==false)_e.setAttribute('${a.name}',String(${val}));`,
        );
        break;
      case 'bool':
        lines.push(
          `if(typeof ${val}==='function')_w(function(){if(${val}())_e.setAttribute('${a.name}','');else _e.removeAttribute('${a.name}');});else if(${val})_e.setAttribute('${a.name}','');`,
        );
        break;
      case 'prop':
        lines.push(
          `if(typeof ${val}==='function')_w(function(){_e.${a.name}=${val}();});else _e.${a.name}=${val};`,
        );
        break;
      case 'reactive-prop':
        lines.push(
          `if(typeof ${val}==='function')_w(function(){_e['${a.name}']=${val}();});else _e['${a.name}']=${val};`,
        );
        break;
      case 'bind': {
        const evt = a.name === 'checked' || a.name === 'group' ? 'change' : 'input';
        if (a.name === 'group') {
          lines.push(
            `if(typeof ${val}==='function'){if(_e.type==='radio'){_w(function(){_e.checked=${val}()===_e.value;});_e.addEventListener('change',function(){if(_e.checked)${val}(_e.value);});}else{_w(function(){_e.checked=${val}().includes(_e.value);});_e.addEventListener('change',function(){var a=[...${val}()],i=a.indexOf(_e.value);if(_e.checked){if(i===-1)a.push(_e.value);}else if(i!==-1)a.splice(i,1);${val}(a);});}}`,
          );
        } else {
          lines.push(
            `if(typeof ${val}==='function'){_w(function(){_e['${a.name}']=${val}();});_e.addEventListener('${evt}',function(){${val}(${a.name === 'checked' ? '_e.checked' : `_e['${a.name}']`});});}`,
          );
        }
        break;
      }
    }
  }

  // Children — text nodes + expressions, appended directly
  for (const ch of tpl.children) {
    if (ch.type === 'text') {
      if (ch.value.trim() || tpl.children.length === 1) {
        lines.push(`_e.appendChild(document.createTextNode(${JSON.stringify(ch.value)}));`);
      }
    } else if (ch.type === 'expression') {
      const val = `_v[${ch.index}]`;
      const id = bindVarCounter++;
      lines.push(
        `var _x${id}=${val};`,
        `if(typeof _x${id}==='function'){var _t${id}=document.createTextNode('');_e.appendChild(_t${id});_w(function(){var r=_x${id}();if(r instanceof Node){_t${id}.replaceWith(r);_t${id}=r;}else{if(_t${id}.nodeType!==3){var t=document.createTextNode('');_t${id}.replaceWith(t);_t${id}=t;}_t${id}.data=r==null?'':String(r);}});}`,
        `else if(_x${id} instanceof Node)_e.appendChild(_x${id});`,
        `else if(Array.isArray(_x${id})){for(var _ai${id}=0;_ai${id}<_x${id}.length;_ai${id}++)_e.appendChild(_x${id}[_ai${id}] instanceof Node?_x${id}[_ai${id}]:document.createTextNode(String(_x${id}[_ai${id}])));}`,
        `else _e.appendChild(document.createTextNode(_x${id}==null||_x${id}===false?'':String(_x${id})));`,
      );
    }
  }

  lines.push('return _e;');
  return `function(_v,_w){${lines.join('')}}`;
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

function buildStaticHtml(node: ASTNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'comment':
      return `<!--${node.value.replace(/-->/g, '--&gt;')}-->`;
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
      return '';
  }
}

// ---------------------------------------------------------------------------
// buildDynamicHtml — build HTML + record positional paths for each slot
//
// currentPath tracks the position of the current node relative to root.
// Each child increments via nextSibling, entering a child uses firstChild.
// ---------------------------------------------------------------------------

function buildDynamicHtml(node: ASTNode, slots: Slot[], currentPath: PathStep[]): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'comment':
      return `<!--${node.value.replace(/-->/g, '--&gt;')}-->`;

    case 'expression': {
      // Insert a comment placeholder — record its path
      slots.push({ type: 'expr', index: node.index, path: [...currentPath] });
      return '<!---->';
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

      // Children: first child gets path + [0 (firstChild)], siblings get [1 (nextSibling)]
      for (let i = 0; i < node.children.length; i++) {
        const _childPath =
          i === 0
            ? [...currentPath, 0 as PathStep] // firstChild
            : [...currentPath, 1 as PathStep]; // nextSibling (from previous)

        // For siblings after first, we need to track relative to previous sibling
        // Actually, we track from the PARENT: firstChild then nextSibling chain
        s += buildDynamicHtml(node.children[i], slots, childPathFromParent(currentPath, i));
      }

      return `${s}</${node.tag}>`;
    }

    case 'fragment': {
      let s = '';
      for (let i = 0; i < node.children.length; i++) {
        s += buildDynamicHtml(node.children[i], slots, childPathFromParent(currentPath, i));
      }
      return s;
    }

    default:
      return '';
  }
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
// No TreeWalker, no querySelector, no switch/case — just direct path walk
// ---------------------------------------------------------------------------

let bindVarCounter = 0;

function genPositionalBindings(slots: Slot[]): string {
  const lines: string[] = [];

  for (const slot of slots) {
    const nodeVar = `_n${bindVarCounter++}`;

    // Generate path navigation: _r.firstChild.nextSibling.firstChild...
    let nav = '_r';
    for (const step of slot.path) {
      nav += step === 0 ? '.firstChild' : '.nextSibling';
    }
    lines.push(`var ${nodeVar}=${nav};`);

    if (slot.type === 'expr') {
      lines.push(genExprBinding(nodeVar, slot.index));
    } else {
      for (const attr of slot.attrs) {
        if (attr.kind !== 'static') {
          lines.push(genAttrBinding(nodeVar, attr));
        }
      }
    }
  }

  return lines.join('');
}

// ---------------------------------------------------------------------------
// Expression binding — replace comment placeholder with dynamic content
// ---------------------------------------------------------------------------

function genExprBinding(commentVar: string, index: number): string {
  const id = bindVarCounter++;
  const xv = `_xv${id}`;
  const tn = `_tn${id}`;
  const val = `_v[${index}]`;

  return [
    `var ${xv}=${val};`,
    `if(typeof ${xv}==='function'){`,
    `var ${tn}=document.createTextNode('');${commentVar}.replaceWith(${tn});`,
    `_w(function(){var r=${xv}();if(r instanceof Node){${tn}.replaceWith(r);${tn}=r;}else{if(${tn}.nodeType!==3){var t=document.createTextNode('');${tn}.replaceWith(t);${tn}=t;}${tn}.data=r==null?'':String(r);}});`,
    `}else if(${xv} instanceof DocumentFragment||${xv} instanceof Node){${commentVar}.replaceWith(${xv});}`,
    `else if(Array.isArray(${xv})){var _f${id}=document.createDocumentFragment();for(var _i${id}=0;_i${id}<${xv}.length;_i${id}++)_f${id}.appendChild(${xv}[_i${id}] instanceof Node?${xv}[_i${id}]:document.createTextNode(String(${xv}[_i${id}])));${commentVar}.replaceWith(_f${id});}`,
    `else{${commentVar}.replaceWith(document.createTextNode(${xv}==null||${xv}===false?'':String(${xv})));}`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Attribute binding
// ---------------------------------------------------------------------------

function genAttrBinding(el: string, attr: AttributeNode): string {
  if (attr.kind === 'static') return '';
  assertSafeName(attr.name, 'attribute');

  const val = `_v[${attr.index}]`;

  switch (attr.kind) {
    case 'event':
      return `${el}.addEventListener('${attr.name}',${val});`;

    case 'dynamic':
      return `if(typeof ${val}==='function')_w(function(){var v=${val}();if(v==null||v===false)${el}.removeAttribute('${attr.name}');else ${el}.setAttribute('${attr.name}',String(v));});else if(${val}!=null&&${val}!==false)${el}.setAttribute('${attr.name}',String(${val}));`;

    case 'bool':
      return `if(typeof ${val}==='function')_w(function(){if(${val}())${el}.setAttribute('${attr.name}','');else ${el}.removeAttribute('${attr.name}');});else if(${val})${el}.setAttribute('${attr.name}','');`;

    case 'prop': {
      const n = attr.name;
      return `if(typeof ${val}==='function')_w(function(){${el}.${n}=${val}();});else ${el}.${n}=${val};`;
    }

    case 'reactive-prop':
      return `if(typeof ${val}==='function')_w(function(){${el}['${attr.name}']=${val}();});else ${el}['${attr.name}']=${val};`;

    case 'bind': {
      const evt = attr.name === 'checked' || attr.name === 'group' ? 'change' : 'input';
      if (attr.name === 'group') {
        return [
          `if(typeof ${val}==='function'){`,
          `if(${el}.type==='radio'){_w(function(){${el}.checked=${val}()===${el}.value;});${el}.addEventListener('change',function(){if(${el}.checked)${val}(${el}.value);});}`,
          `else{_w(function(){${el}.checked=${val}().includes(${el}.value);});${el}.addEventListener('change',function(){var a=[...${val}()],i=a.indexOf(${el}.value);if(${el}.checked){if(i===-1)a.push(${el}.value);}else if(i!==-1)a.splice(i,1);${val}(a);});}}`,
        ].join('');
      }
      return `if(typeof ${val}==='function'){_w(function(){${el}['${attr.name}']=${val}();});${el}.addEventListener('${evt}',function(){${val}(${attr.name === 'checked' ? `${el}.checked` : `${el}['${attr.name}']`});});}`;
    }

    default:
      return '';
  }
}
