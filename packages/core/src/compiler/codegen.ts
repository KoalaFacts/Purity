// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// ALL templates use cloneNode — one C++ call creates the entire DOM tree.
//
// Static: innerHTML + cloneNode(true) — zero JS per render
// Dynamic: innerHTML with markers + cloneNode(true) + walk markers to bind
//
// This matches Solid/Lit: clone is 5-10x faster than N createElement calls.
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
// generate(ast) — ALWAYS cloneNode, even for dynamic templates
// ---------------------------------------------------------------------------

export function generate(ast: FragmentNode): string {
  if (!hasDynamic(ast)) {
    const html = buildHtml(ast, null);
    if (!html.trim()) return 'function(){return document.createDocumentFragment();}';
    return [
      '(function(){',
      `var _t=document.createElement('template');`,
      `_t.innerHTML=${JSON.stringify(html)};`,
      'return function(){return _t.content.cloneNode(true);};',
      '})()',
    ].join('');
  }

  // Dynamic: build HTML with comment markers + data-p attrs
  // Template created ONCE in outer closure, cloned per call
  const markers: MarkerBinding[] = [];
  const html = buildHtml(ast, markers);

  // Generate binding code that walks the cloned DOM
  const bindCode = genBindings(markers);

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
// Types for marker-based binding
// ---------------------------------------------------------------------------

interface MarkerBinding {
  type: 'expr';
  marker: string; // comment marker name
  index: number;  // expression index
}

interface AttrMarkerBinding {
  type: 'attr';
  markerId: number;
  attrs: AttributeNode[];
}

type Binding = MarkerBinding | AttrMarkerBinding;

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
// buildHtml — build HTML string, inserting markers for dynamic parts
// If markers is null, build pure static HTML.
// ---------------------------------------------------------------------------

let markerCounter = 0;

function buildHtml(node: ASTNode, markers: Binding[] | null): string {
  switch (node.type) {
    case 'text':
      return node.value;

    case 'comment':
      return `<!--${node.value}-->`;

    case 'expression': {
      if (!markers) return '';
      const marker = `p${markerCounter++}`;
      markers.push({ type: 'expr', marker, index: node.index });
      return `<!--${marker}-->`;
    }

    case 'element': {
      assertSafeName(node.tag, 'tag');
      let s = `<${node.tag}`;

      const dynamicAttrs: AttributeNode[] = [];

      for (const a of node.attributes) {
        if (a.kind === 'static') {
          s += a.value ? ` ${a.name}="${a.value}"` : ` ${a.name}`;
        } else {
          dynamicAttrs.push(a);
        }
      }

      if (dynamicAttrs.length > 0 && markers) {
        const id = markerCounter++;
        s += ` data-p="${id}"`;
        markers.push({ type: 'attr', markerId: id, attrs: dynamicAttrs });
      }

      if (VOID.has(node.tag)) return `${s}/>`;
      s += '>';
      for (const ch of node.children) s += buildHtml(ch, markers);
      return `${s}</${node.tag}>`;
    }

    case 'fragment':
      return node.children.map((ch) => buildHtml(ch, markers)).join('');

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// genBindings — generate JS code to wire up dynamic parts on a clone
// Uses querySelector for attr bindings, TreeWalker for comment markers
// ---------------------------------------------------------------------------

function genBindings(markers: Binding[]): string {
  const lines: string[] = [];

  // Collect all expression markers (need TreeWalker)
  const exprMarkers = markers.filter((m) => m.type === 'expr') as MarkerBinding[];
  const attrMarkers = markers.filter((m) => m.type === 'attr') as AttrMarkerBinding[];

  // Expression markers: collect all comments first, then process
  // (replaceWith invalidates TreeWalker position — must not modify during walk)
  if (exprMarkers.length > 0) {
    lines.push('var _w2=document.createTreeWalker(_r,128,null),_cm,_cms=[];');
    lines.push('while(_cm=_w2.nextNode())_cms.push(_cm);');
    lines.push('for(var _ci=0;_ci<_cms.length;_ci++){var _c=_cms[_ci];');
    lines.push('switch(_c.data){');
    for (const m of exprMarkers) {
      lines.push(`case ${JSON.stringify(m.marker)}:{`);
      lines.push(genExprBinding(m));
      lines.push('break;}');
    }
    lines.push('}}');
  }

  // Attribute markers: querySelector for each
  for (const m of attrMarkers) {
    const el = `_e${m.markerId}`;
    lines.push(`var ${el}=_r.querySelector('[data-p="${m.markerId}"]');${el}.removeAttribute('data-p');`);
    for (const attr of m.attrs) {
      lines.push(genAttrBinding(el, attr));
    }
  }

  return lines.join('');
}

// ---------------------------------------------------------------------------
// Expression binding — replace comment with dynamic content
// ---------------------------------------------------------------------------

let bindVarCounter = 0;

function genExprBinding(m: MarkerBinding): string {
  const val = `_v[${m.index}]`;
  const id = bindVarCounter++;
  const xv = `_xv${id}`;
  const tn = `_tn${id}`;

  const lines: string[] = [];
  lines.push(`var ${xv}=${val};`);
  lines.push(`if(typeof ${xv}==='function'){`);
  lines.push(`var ${tn}=document.createTextNode('');_c.replaceWith(${tn});`);
  lines.push(`_w(function(){var r=${xv}();if(r instanceof Node){${tn}.replaceWith(r);${tn}=r;}else{if(${tn}.nodeType!==3){var t=document.createTextNode('');${tn}.replaceWith(t);${tn}=t;}${tn}.data=r==null?'':String(r);}});`);
  lines.push(`}else if(${xv} instanceof DocumentFragment||${xv} instanceof Node){_c.replaceWith(${xv});}`);
  lines.push(`else if(Array.isArray(${xv})){var _f${id}=document.createDocumentFragment();for(var _i${id}=0;_i${id}<${xv}.length;_i${id}++)_f${id}.appendChild(${xv}[_i${id}] instanceof Node?${xv}[_i${id}]:document.createTextNode(String(${xv}[_i${id}])));_c.replaceWith(_f${id});}`);
  lines.push(`else{_c.replaceWith(document.createTextNode(${xv}==null||${xv}===false?'':String(${xv})));}`);

  return lines.join('');
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
