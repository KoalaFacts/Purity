// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// Two strategies:
// 1. Static templates: innerHTML + cloneNode (fastest for no-binding templates)
// 2. Dynamic templates: direct createElement/createTextNode (no TreeWalker overhead)
//
// Tighter output than before — minimal variable names, fewer lines.
// ---------------------------------------------------------------------------

import type {
  ASTNode,
  AttributeNode,
  ElementNode,
  ExpressionNode,
  FragmentNode,
  TextNode,
} from './ast.js';

const SAFE_NAME = /^[a-zA-Z_][\w.-]*$/;
function assertSafeName(name: string, kind: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`[Purity] Invalid ${kind} name: "${name}"`);
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Ctx {
  code: string[];
  n: number; // variable counter
}

function ctx(): Ctx { return { code: [], n: 0 }; }
function v(c: Ctx, p: string): string { return `_${p}${c.n++}`; }
function out(c: Ctx, s: string): void { c.code.push(s); }

// ---------------------------------------------------------------------------
// generate(ast) — entry point
// ---------------------------------------------------------------------------

export function generate(ast: FragmentNode): string {
  if (!hasDynamic(ast)) {
    // Pure static — cloneNode approach (template created once in closure)
    const html = staticHtml(ast);
    if (!html.trim()) return 'function(){return document.createDocumentFragment();}';
    return `(function(){var _t=document.createElement('template');_t.innerHTML=${JSON.stringify(html)};return function(){return _t.content.cloneNode(true);};})()`
  }

  // Dynamic — direct DOM creation (no innerHTML overhead)
  const c = ctx();
  if (ast.children.length === 1) {
    const r = genNode(c, ast.children[0]);
    out(c, `return ${r};`);
  } else {
    const f = v(c, 'f');
    out(c, `var ${f}=document.createDocumentFragment();`);
    for (const child of ast.children) {
      out(c, `${f}.appendChild(${genNode(c, child)});`);
    }
    out(c, `return ${f};`);
  }

  return `function(_v,_w){${c.code.join('')}}`;
}

export function generateModule(ast: FragmentNode): string {
  return `export default ${generate(ast)}`;
}

// ---------------------------------------------------------------------------
// Static check
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
// Static HTML builder (for cloneNode path)
// ---------------------------------------------------------------------------

function staticHtml(node: ASTNode): string {
  switch (node.type) {
    case 'text': return node.value;
    case 'comment': return `<!--${node.value}-->`;
    case 'element': {
      assertSafeName(node.tag, 'tag');
      let s = `<${node.tag}`;
      for (const a of node.attributes) {
        if (a.kind === 'static') s += a.value ? ` ${a.name}="${a.value}"` : ` ${a.name}`;
      }
      if (VOID.has(node.tag)) return `${s}/>`;
      s += '>';
      for (const ch of node.children) s += staticHtml(ch);
      return `${s}</${node.tag}>`;
    }
    case 'fragment': return node.children.map(staticHtml).join('');
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Dynamic DOM node generators — tighter output, shorter var names
// ---------------------------------------------------------------------------

function genNode(c: Ctx, node: ASTNode): string {
  switch (node.type) {
    case 'element': return genEl(c, node);
    case 'text': return genTxt(c, node);
    case 'expression': return genExpr(c, node);
    case 'comment': { const x = v(c, 'c'); out(c, `var ${x}=document.createComment(${JSON.stringify(node.value)});`); return x; }
    case 'fragment': { const x = v(c, 'f'); out(c, `var ${x}=document.createDocumentFragment();`); for (const ch of node.children) out(c, `${x}.appendChild(${genNode(c, ch)});`); return x; }
  }
}

function genEl(c: Ctx, node: ElementNode): string {
  assertSafeName(node.tag, 'tag');
  const e = v(c, 'e');
  out(c, `var ${e}=document.createElement('${node.tag}');`);

  // Static attrs inline, collect bind attrs for after children
  const bindAttrs: AttributeNode[] = [];
  for (const a of node.attributes) {
    if (a.kind === 'bind') { bindAttrs.push(a); continue; }
    genAttr(c, e, a);
  }

  for (const ch of node.children) out(c, `${e}.appendChild(${genNode(c, ch)});`);
  for (const a of bindAttrs) genAttr(c, e, a);

  return e;
}

function genTxt(c: Ctx, node: TextNode): string {
  const t = v(c, 't');
  out(c, `var ${t}=document.createTextNode(${JSON.stringify(node.value)});`);
  return t;
}

function genExpr(c: Ctx, node: ExpressionNode): string {
  const x = v(c, 'x');
  const val = `_v[${node.index}]`;

  out(c, `var ${x}=${val},${x}n;`);
  out(c, `if(typeof ${x}==='function'){${x}n=document.createTextNode('');_w(function(){var r=${x}();if(r instanceof Node){${x}n.replaceWith(r);${x}n=r;}else{if(${x}n.nodeType!==3){var t=document.createTextNode('');${x}n.replaceWith(t);${x}n=t;}${x}n.data=r==null?'':String(r);}});}`);
  out(c, `else if(${x} instanceof DocumentFragment)${x}n=${x};`);
  out(c, `else if(${x} instanceof Node)${x}n=${x};`);
  out(c, `else if(Array.isArray(${x})){${x}n=document.createDocumentFragment();for(var _i=0;_i<${x}.length;_i++)${x}n.appendChild(${x}[_i] instanceof Node?${x}[_i]:document.createTextNode(String(${x}[_i])));}`);
  out(c, `else ${x}n=document.createTextNode(${x}==null||${x}===false?'':String(${x}));`);

  return `${x}n`;
}

// ---------------------------------------------------------------------------
// Attribute generators — tight output
// ---------------------------------------------------------------------------

function genAttr(c: Ctx, el: string, attr: AttributeNode): void {
  if (attr.kind === 'static') {
    const n = attr.name;
    if (n === 'id' || n === 'class') {
      out(c, `${el}.${n === 'class' ? 'className' : n}=${JSON.stringify(attr.value)};`);
    } else {
      out(c, `${el}.setAttribute('${n}',${JSON.stringify(attr.value || '')});`);
    }
    return;
  }

  const val = `_v[${attr.index}]`;

  switch (attr.kind) {
    case 'event':
      out(c, `${el}.addEventListener('${attr.name}',${val});`);
      break;

    case 'dynamic':
      out(c, `if(typeof ${val}==='function')_w(function(){var v=${val}();if(v==null||v===false)${el}.removeAttribute('${attr.name}');else ${el}.setAttribute('${attr.name}',String(v));});`);
      out(c, `else if(${val}!=null&&${val}!==false)${el}.setAttribute('${attr.name}',String(${val}));`);
      break;

    case 'bool':
      out(c, `if(typeof ${val}==='function')_w(function(){if(${val}())${el}.setAttribute('${attr.name}','');else ${el}.removeAttribute('${attr.name}');});`);
      out(c, `else if(${val})${el}.setAttribute('${attr.name}','');`);
      break;

    case 'prop':
      out(c, `if(typeof ${val}==='function')_w(function(){${el}.${attr.name}=${val}();});else ${el}.${attr.name}=${val};`);
      break;

    case 'reactive-prop':
      out(c, `if(typeof ${val}==='function')_w(function(){${el}['${attr.name}']=${val}();});else ${el}['${attr.name}']=${val};`);
      break;

    case 'bind': {
      const evt = attr.name === 'checked' || attr.name === 'group' ? 'change' : 'input';
      if (attr.name === 'group') {
        out(c, `if(typeof ${val}==='function'){if(${el}.type==='radio'){_w(function(){${el}.checked=${val}()===${el}.value;});${el}.addEventListener('change',function(){if(${el}.checked)${val}(${el}.value);});}`);
        out(c, `else{_w(function(){${el}.checked=${val}().includes(${el}.value);});${el}.addEventListener('change',function(){var a=[...${val}()],i=a.indexOf(${el}.value);if(${el}.checked){if(i===-1)a.push(${el}.value);}else if(i!==-1)a.splice(i,1);${val}(a);});}}`);
      } else {
        out(c, `if(typeof ${val}==='function'){_w(function(){${el}['${attr.name}']=${val}();});${el}.addEventListener('${evt}',function(){${val}(${attr.name === 'checked' ? `${el}.checked` : `${el}['${attr.name}']`});});}`);
      }
      break;
    }
  }
}
