// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// Client templates take one of three paths:
//   Static: built once with DOM APIs into a <template> (no innerHTML, so no
//     Trusted Types sink and no parser rewrites), cloneNode per instance.
//   Simple (one element whose children are text/expressions): createElement
//     per instance, with text-only update code (measurably faster updates).
//   Dynamic: innerHTML with markers parsed once into a <template>, cloneNode
//     per instance, then positional paths (firstChild/nextSibling) to reach
//     dynamic parts — no TreeWalker search.
// ---------------------------------------------------------------------------

import type { ASTNode, AttributeNode, ElementNode, FragmentNode } from './ast.ts';
import { VOID_TAGS as VOID } from './parser.ts';
import { escAttr as escapeAttr, escHtml as escapeHtml } from './ssr-runtime.ts';

// JSON quoting protects JavaScript syntax; HTML delimiters must also be escaped
// when a caller embeds generated code in an inline script. This only runs at
// compile time, and evaluating the literal preserves the original string.
function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ---------------------------------------------------------------------------
// Codegen safety contract — relevant for the GitHub Advanced Security
// "code injection" finding on the function-string returns below.
//
// The codegen emits JS source that is later run via `new Function()` in
// compile.ts. Every value spliced into that source is constrained at
// emission time:
//
//   * Tag names and attribute names come from the parsed AST and pass
//     through assertSafeName below before any interpolation. The regex
//     [a-zA-Z_][\w-]* disallows everything that could escape an
//     identifier or single-quoted string — no dots, brackets, quotes,
//     parentheses, semicolons, whitespace, or control chars. Anything
//     non-conforming throws at compile time.
//   * Names are additionally passed through jsString at every
//     emission site (qname / qevt / json-quoted tag), and used as
//     bracket-notation property keys (`_e[${qname}]`) rather than dot
//     access. Layered defense: even if the regex were ever loosened,
//     the splices still produce well-formed string literals.
//   * String LITERAL values (text content, attribute values) are
//     JSON quoted and HTML-delimiter escaped by jsString before splicing.
//   * Variables like `_v[N]`, `_av${id}`, `_n${id}` are framework-
//     internal identifiers, not user data.
//
// CodeQL's code-injection analysis cannot follow the validated-name contract
// in every emitter, so the relevant return statements carry a per-line
// suppression directive pointing back here.
// ---------------------------------------------------------------------------

const SAFE_NAME = /^[a-zA-Z_][\w-]*$/;
function assertSafeName(name: string, kind: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`[Purity] Invalid ${kind} name: "${name}"`);
}

function assertSafeBinding(name: string, kind: string): void {
  if (kind !== 'event' && (/^on/i.test(name) || name.toLowerCase() === 'srcdoc')) {
    throw new Error(
      `[Purity] Unsafe dynamic binding "${name}"; use @event listeners or explicit DOM APIs for trusted HTML.`,
    );
  }
}

const UNSAFE_SCRIPT_BINDING =
  '[Purity] Unsafe dynamic binding in <script>; keep code static and serialize data separately.';

function assertSafeScriptContent(node: ASTNode, inScript = false): void {
  if (node.type === 'expression' && inScript) {
    // HTML escaping cannot make data safe as JavaScript source in a raw-text element.
    throw new Error(UNSAFE_SCRIPT_BINDING);
  }
  if (node.type !== 'element' && node.type !== 'fragment') return;
  const script = inScript || (node.type === 'element' && node.tag.toLowerCase() === 'script');
  if (script && node.type === 'element') {
    for (const attr of node.attributes) {
      if (
        attr.kind !== 'static' &&
        /^(?:innerhtml|outerhtml|text|textcontent|innertext)$/i.test(attr.name)
      ) {
        throw new Error(UNSAFE_SCRIPT_BINDING);
      }
    }
  }
  for (const child of node.children) assertSafeScriptContent(child, script);
}

const URL_BINDINGS = new Set(
  'href src action formaction poster background cite data codebase manifest longdesc profile usemap'.split(
    ' ',
  ),
);

function safeBindingValue(name: string, expr: string): string {
  if (!URL_BINDINGS.has(name.toLowerCase())) return expr;
  // Escape-only attribute binding does not stop executable URL schemes.
  // Return the checked string so stateful toString() cannot change it later.
  return `(function(v){if(v==null||v===false)return v;if(v===true)return '';var s=String(v),p=s.replace(/[\\u0000-\\u0020\\u007f]/g,'');if(/^(?:javascript|vbscript):/i.test(p)||(/^data:/i.test(p)&&!/^data:image\\/(?:png|jpeg|gif|webp|avif|bmp|x-icon);base64,/i.test(p)))throw new Error('[Purity] Unsafe URL binding');return s;})(${expr})`;
}

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
  tag: string;
  attrs: AttributeNode[];
  path: PathStep[];
}

// A raw-text / RCDATA element with expression children. The HTML parser makes
// its content a single text node, so the expressions cannot have positional
// slots. The element gets one slot instead, and its text is rebuilt from parts.
interface RawContentSlot {
  type: 'raw';
  children: ASTNode[];
  path: PathStep[];
}

type Slot = ExprSlot | AttrSlot | RawContentSlot;

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

const PRESERVE_WS_TAGS = /^(?:pre|textarea|script|style)$/;

function isIndentation(n: ASTNode): boolean {
  return n.type === 'text' && n.value.trim() === '' && n.value.includes('\n');
}

// U+200B ZERO WIDTH SPACE — used as the inline placeholder character for
// reactive `${...}` expressions. The HTML parser turns it into a single Text
// node so we can navigate to it positionally and either keep it (reactive
// text) or replaceWith it (Node / Array values) without an extra
// createTextNode + replaceWith pair.
const EXPR_PLACEHOLDER = '​';

// Raw-text elements (`ElementNode.raw`, set by the parser for HTML-namespace
// style/script/textarea/title): the HTML parser does not parse markup inside
// them. RAWTEXT ('text': style, script) does not decode entities either, so
// text is emitted verbatim. RCDATA ('rcdata': textarea, title) decodes
// entities, so text is escaped. Neither can carry hydration markers or
// placeholders (they would become literal text), so their dynamic content is
// rebuilt as one text node.
const hasExpressionChild = (node: ElementNode): boolean =>
  node.children.some((c) => c.type === 'expression');
// Source for one raw-content part: the parser gives raw-text / RCDATA elements
// only text and expression children (see parseRawChildren).
const rawPart = (node: ASTNode, value: (index: number) => string): string =>
  node.type === 'expression' ? value(node.index) : jsString(node.type === 'text' ? node.value : '');

export function condenseWhitespace(node: ASTNode): ASTNode {
  if (node.type === 'fragment' || node.type === 'element') {
    if (node.type === 'element' && PRESERVE_WS_TAGS.test(node.tag.toLowerCase())) return node;
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

/**
 * Client factory source that references `__purity_fl__` / `__purity_sw__` as
 * free names. Host code must bind them: compile.ts for JIT, an import for AOT
 * modules. Static templates reference neither.
 */
export function generateLinked(ast: FragmentNode): string {
  assertSafeScriptContent(ast);
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
    // codeql[js/code-injection] — see "Codegen safety contract" near SAFE_NAME.
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
  const templatePrep = genTemplateCommentToTextConversion(slots);

  // codeql[js/code-injection] — see "Codegen safety contract" near SAFE_NAME.
  // `html` was built by buildDynamicHtml which JSON.stringify's all values
  // and assertSafeName-validates all tag/attr names. `bindCode` interpolates
  // only validated names through JSON.stringify and bracket notation.
  return [
    '(function(){',
    `var _t=document.createElement('template');`,
    `_t.innerHTML=${jsString(html)};`,
    templatePrep,
    'return function(_v,_w,_d){',
    'var _r=_t.content.cloneNode(true);',
    bindCode,
    'return _r;',
    '};',
    '})()',
  ].join('');
}

// One-time template prep: convert each comment placeholder (used for
// expression slots that have a text/expression sibling, where the parser
// would coalesce) into an empty Text node inside `_t.content`. After this,
// every reactive expression slot — text-placeholder OR comment-placeholder
// — is a Text node when cloned, so the per-row binding code never has to
// createTextNode + replaceWith. For a 10k-row table with two such slots
// per row, that's 40k DOM ops eliminated (the cost paid is two replaceWith
// calls once at module-init time).
function genTemplateCommentToTextConversion(slots: Slot[]): string {
  const stmts: string[] = [];
  for (const slot of slots) {
    if (slot.type !== 'expr' || slot.textPlaceholder) continue;
    const id = bindVarCounter++;
    let nav = '_t.content';
    for (const step of slot.path) nav += step === 0 ? '.firstChild' : '.nextSibling';
    stmts.push(
      `var _cs${id}=${nav};_cs${id}.parentNode.replaceChild(document.createTextNode(''),_cs${id});`,
    );
  }
  return stmts.join('');
}

// Standalone modules import the coercion helpers the generated code references.
const VALUE_HELPER_IMPORT =
  "import { flattenValue as __purity_fl__, swapSlot as __purity_sw__ } from '@purityjs/core/compiler';\n";

export function generateModule(ast: FragmentNode): string {
  return `${VALUE_HELPER_IMPORT}export default ${generateLinked(ast)}`;
}

// ---------------------------------------------------------------------------
// generateHydrate(ast)
//
// Emits a factory `function (_v, _w, _r, ..., _s) { ...; return _r; }` that walks the
// SSR-rendered DOM subtree `_r`, attaching reactive bindings to existing
// nodes instead of building new ones. Mirrors generate()'s slot semantics
// against the marker-wrapped SSR layout: every `${...}` slot in the SSR
// output is `<!--[--> ...content... <!--]-->`, and the generator walks
// siblings between markers to discover the actual content nodes (which may
// be empty, a single text node, or arbitrary subtrees).
//
// `_r` is a Node container whose direct children are the SSR roots for this
// template instance (a DocumentFragment for top-level hydrate, the parent
// fragment of a slot's content for nested templates).
//
// The generator walks the AST in order and threads a "cursor" variable
// through siblings — element children consume one DOM node, expression
// children consume marker-open + content + marker-close, advancing the
// cursor past the close marker. Path-based navigation (used by generate())
// can't be reused because per-slot content sizes vary at runtime.
// ---------------------------------------------------------------------------

interface HydrateCtx {
  setup: string[];
  reactive: string[];
  id: number;
}

/** Hydrate factory source with the same free-name contract as generateLinked. */
export function generateHydrateLinked(ast: FragmentNode): string {
  assertSafeScriptContent(ast);
  ast = condenseWhitespace(ast) as FragmentNode;

  if (!hasDynamic(ast)) {
    return 'function(_v,_w,_r,_i,_c,_e,_m,_s){return _r;}';
  }

  const ctx: HydrateCtx = { setup: [], reactive: [], id: 0 };
  // Top-level cursor = first child of the SSR root container.
  ctx.setup.push('var _c0=_s===undefined?_r.firstChild:_s;');
  emitHydrateChildren(ast.children, ctx, '_c0');

  let body = ctx.setup.join('');
  if (ctx.reactive.length > 0) {
    body += `_w(function(){${ctx.reactive.join('')}});`;
  }
  body += 'return _r;';

  // All identifiers spliced into `body` are framework-internal counters
  // (_c0, _el<id>, _open<id>, …) or have been validated/JSON.stringify'd by
  // the genAttrBinding / inline emitters used here. `_i` is the runtime
  // inflateDeferred helper, `_c` the optional cursor-check fn, `_e` the
  // inflateDeferredEach helper, and `_m` the inflateDeferredMatch helper —
  // all threaded through by compile.ts. See "Codegen safety contract"
  // near SAFE_NAME for the full audit.
  // Parsed indices are numeric; names are validated above and literal text
  // is emitted with JSON.stringify.
  // codeql[js/bad-code-sanitization]
  return `function(_v,_w,_r,_i,_c,_e,_m,_s){${body}}`;
}

// Standalone helper definitions, equivalent to flattenValue / swapSlot in
// value-helpers.ts (the conformance switching tests run both). Used only to
// make the public generate()/generateHydrate() output evaluable on its own.
const VALUE_HELPER_DEFS =
  'var __purity_fl__=function(v,o,s){if(typeof v==="function")v=v();if(v==null||v===false)return o;' +
  'if(Array.isArray(v)){if(s===null)s=new WeakSet();if(s.has(v))return o;s.add(v);' +
  'for(var i=0;i<v.length;i++)__purity_fl__(v[i],o,s);}else o.push(v);return o;};' +
  'var __purity_sw__=function(c,v,m){var N=[],t=1,s="",O=Array.isArray(c)?c:[c],l=O[O.length-1],' +
  'p=l.parentNode,a=l.nextSibling,f=document.createDocumentFragment(),K;' +
  '(Array.isArray(v)?__purity_fl__(v,[],null):v==null||v===false?[]:[v]).forEach(function(y){' +
  'if(m&&y&&y.__purity_deferred__===true)m(y,y=document.createDocumentFragment(),false,true);' +
  'if(!(y instanceof Node)){s+=y=String(y);N.push(y);}else if(y.nodeType!==11){t=0;N.push(y);}' +
  'else for(t=0,y=y.firstChild;y;y=y.nextSibling)N.push(y);});' +
  'N=t?[O[1]||l.nodeType!==3?document.createTextNode(""):l]:N.map(function(y){return typeof y=="string"?document.createTextNode(y):y;});' +
  'if(t)N[0].data=s;N[0]||N.push(document.createTextNode(""));' +
  'if(p){K=new Set(N);O.forEach(function(o){K.has(o)||o.remove();});N.forEach(function(n){f.appendChild(n);});p.insertBefore(f,a);}' +
  'return N[1]?N:N[0];};';

// Wrap linked source so it evaluates on its own, binding the helpers once per
// factory. Output without helper references is returned unchanged.
// Shared generated-code fragments for dynamic text/node slots. Each was
// emitted from several generator paths; keeping one copy keeps the runtime
// compiler small and the paths from drifting.

// Re-render a slot from its accessor through swapSlot (value-helpers.ts),
// which keeps `tn` pointing at the slot's current Text node or Node list.
// Hydration passes `_i` so templates captured as deferred are built.
function slotUpdate(xv: string, tn: string, hydrating = false): string {
  return `${tn}=__purity_sw__(${tn},${xv}()${hydrating ? ',_i' : ''});`;
}

// Raw-text / RCDATA element content: rewrite the element's text from the parts
// on every change. `value(i)` is the source expression for template value i on
// the calling path. A value is coerced to text like valueToHtml: functions are
// called (inside the watch, so their signals are tracked) and arrays flattened;
// a Node leaf (nested template, each(), when()/match()) is kept in a detached
// holder and contributes its live textContent, re-read by a MutationObserver
// when its own bindings update it.
// During hydration (`hydrating`) nested templates and control flow arrive as
// deferred carriers and are rendered into a fragment first.
function rawContentBinding(
  el: string,
  children: ASTNode[],
  value: (index: number) => string,
  hydrating: boolean,
): string {
  const id = bindVarCounter++;
  const parts = `_rp${id}`;
  const write = `_rw${id}`;
  const observer = `_ro${id}`;
  const leaf = `_rl${id}`;
  let setup =
    `var ${parts}=[],${observer}=new MutationObserver(function(){${write}();});` +
    `var ${write}=function(){var t='';for(var i=0;i<${parts}.length;i++){var p=${parts}[i];t+=p instanceof Node?p.textContent:p;}${el}.textContent=t;};` +
    `var ${leaf}=function(y){` +
    `if(typeof y==='object'&&!(y instanceof Node)){var f=document.createDocumentFragment();` +
    // Branded SSR HTML (e.g. a retained eachSSR() result): parse it for its text.
    `if(typeof y.__purity_ssr_html__==='string'){var t=document.createElement('template');t.innerHTML=y.__purity_ssr_html__;y=t.content;}` +
    (hydrating
      ? `else if(y.__purity_deferred__===true){_i(y,f,false,true);y=f;}` +
        `else if(y.__purity_deferred_each__===true||y.__purity_deferred_match__===true){` +
        `var m=f.appendChild(document.createComment(''));(y.__purity_deferred_each__?_e:_m)(y,[],m);y=f;}`
      : '') +
    `}` +
    // One holder per Node, so a Node used in two slots counts twice instead of
    // being moved out of the first holder.
    `if(y instanceof Node){var h=y.__purity_raw__;if(!h){h=y.__purity_raw__=document.createElement('div');h.appendChild(y);}` +
    `${observer}.observe(h,{subtree:true,childList:true,characterData:true});return h;}` +
    `return String(y);};`;
  const list: string[] = [];
  for (const ch of children) {
    if (ch.type !== 'expression') list.push(rawPart(ch, value));
    else {
      const x = `_rx${id}_${ch.index}`;
      setup += `var ${x}=${value(ch.index)};`;
      // Flatten (calling functions, dropping null/false), then coerce each leaf.
      list.push(`__purity_fl__(${x},[],null).map(${leaf})`);
    }
  }
  // Its own watch, so the cleanup disconnects the observer on every re-run and
  // when the owner is disposed.
  return `${setup}_w(function(){${parts}=[].concat(${list.join(',')});${write}();return function(){${observer}.disconnect();};});`;
}

function standalone(code: string): string {
  if (!/__purity_(fl|sw)__/.test(code)) return code;
  return `(function(){${VALUE_HELPER_DEFS}return ${code};})()`;
}

/** Public: standalone client factory source, evaluable with `new Function`. */
export function generate(ast: FragmentNode): string {
  return standalone(generateLinked(ast));
}

/** Public: standalone hydrate factory source, evaluable with `new Function`. */
export function generateHydrate(ast: FragmentNode): string {
  return standalone(generateHydrateLinked(ast));
}

export function generateHydrateModule(ast: FragmentNode): string {
  return `${VALUE_HELPER_IMPORT}export default ${generateHydrateLinked(ast)}`;
}

function emitHydrateChildren(children: ASTNode[], ctx: HydrateCtx, cursor: string): void {
  for (const ch of children) {
    emitHydrate(ch, ctx, cursor);
  }
}

function emitHydrate(node: ASTNode, ctx: HydrateCtx, cursor: string): void {
  switch (node.type) {
    case 'text': {
      // Pass the AST's text value as `detail` so the runtime helper can
      // flag silent content divergence (SSR sent different bytes for the
      // same structural slot). Codegen safety: JSON.stringify of an AST
      // string literal — the same form used everywhere else in this file.
      ctx.setup.push(
        `_c&&_c(${cursor},'text',${jsString(node.value)});`,
        `${cursor}=${cursor}.nextSibling;`,
      );
      return;
    }
    case 'comment': {
      ctx.setup.push(`_c&&_c(${cursor},'comment');`, `${cursor}=${cursor}.nextSibling;`);
      return;
    }

    case 'expression': {
      const id = ctx.id++;
      const open = `_open${id}`;
      const close = `_close${id}`;
      const cont = `_cn${id}`;
      const xv = `_xv${id}`;
      const fl = `_xf${id}`;
      const tn = `_tn${id}`;
      const w = `_w${id}`;
      const depth = `_depth${id}`;
      const val = `_v[${node.index}]`;

      // Cursor is on the open marker `<!--[-->`. Walk siblings until we hit
      // the matching `<!--]-->`, collecting content nodes (may be empty).
      ctx.setup.push(
        `_c&&_c(${cursor},'open');`,
        `var ${open}=${cursor};`,
        `var ${cont}=[];`,
        `var ${depth}=1;`,
        `var ${w}=${open}.nextSibling;`,
        `while(${w}){if(${w}.nodeType===8){if(${w}.data==='[')${depth}++;else if(${w}.data===']'&&--${depth}===0)break;}${cont}.push(${w});${w}=${w}.nextSibling;}`,
        `var ${close}=${w};`,
      );

      // What swapSlot starts from: the slot's SSR nodes, or an empty Text node
      // holding the position of an empty slot.
      const hold = `${cont}.length>1?${cont}:${cont}[0]||${close}.parentNode.insertBefore(document.createTextNode(''),${close})`;
      // Bind based on the user's value. Mirrors generate()'s genExprBinding
      // type-dispatch plus a deferred-template branch for nested `html\`\``
      // and an SSR-branded escape hatch for users who left an `eachSSR(...)`
      // in client code.
      ctx.setup.push(
        `var ${xv}=${val};`,
        `var ${fl}=typeof ${xv}==='function';`,
        // Reactive accessor: the watch's first run adopts a single SSR text
        // node and re-renders anything else.
        `var ${tn};if(${fl})${tn}=${hold};`,
        // Static value branches.
        `else if(${xv}!=null&&typeof ${xv}==='object'){`,
        `if(${xv}.__purity_deferred__===true){`,
        // Nested template — inflate against a fragment containing this slot's
        // SSR content; re-insert before the close marker afterward.
        `var _df${id}=document.createDocumentFragment();_df${id}.append.apply(_df${id},${cont});_i(${xv},_df${id});${close}.before(_df${id});`,
        `}`,
        // Deferred each() — adopt SSR rows in place rather than rebuild.
        `else if(${xv}.__purity_deferred_each__===true){_e(${xv},${cont},${close});}`,
        // Deferred match()/when() — adopt the SSR-rendered case in place.
        `else if(${xv}.__purity_deferred_match__===true){_m(${xv},${cont},${close});}`,
        // Branded SSR HTML wrapper (e.g. eachSSR result) — SSR DOM is already
        // correct; nothing to bind on the client.
        `else if(typeof ${xv}.__purity_ssr_html__==='string'){}`,
        // A Node or an array replaces the SSR content; templates in an array
        // were captured as deferred and are built by swapSlot.
        `else __purity_sw__(${hold},${xv},_i);`,
        `}`,
        // Primitive — SSR text already correct (or correctly empty); no-op.
      );

      ctx.reactive.push(`if(${fl}){`, slotUpdate(xv, tn, true), `}`);

      // Advance cursor past the close marker.
      ctx.setup.push(`${cursor}=${close}.nextSibling;`);
      return;
    }

    case 'element': {
      assertSafeName(node.tag, 'tag');
      const id = ctx.id++;
      const el = `_el${id}`;
      ctx.setup.push(`_c&&_c(${cursor},${jsString(node.tag.toLowerCase())});`);
      ctx.setup.push(`var ${el}=${cursor};`);

      // Apply attribute bindings — events install listeners; dynamic/prop/
      // bind/bool reuse the existing genAttrBinding emitter, which is
      // correct against an existing element (setAttribute on an already-set
      // attribute is a no-op; props weren't set by SSR and need to be).
      for (const attr of node.attributes) {
        if (attr.kind !== 'static') {
          const { setup, reactive } = genAttrBinding(el, attr, node.tag);
          if (setup) ctx.setup.push(setup);
          if (reactive) ctx.reactive.push(reactive);
        }
      }

      // Raw-text / RCDATA content with dynamic parts: SSR wrote no markers, so
      // rebuild the element's text from its parts instead of walking children.
      if (node.raw && hasExpressionChild(node)) {
        ctx.setup.push(rawContentBinding(el, node.children, (i) => `_v[${i}]`, true));
      } else if (
        !VOID.has(node.tag.toLowerCase()) &&
        node.children.length > 0 &&
        !node.tag.includes('-')
      ) {
        // Recurse into children. Hyphenated tags are Custom Elements — their
        // shadow root is opaque to the outer hydrator; the element's own
        // connectedCallback handles its interior. Skip walking children here.
        const child = `_ch${id}`;
        ctx.setup.push(`var ${child}=${el}.firstChild;`);
        emitHydrateChildren(node.children, ctx, child);
      }

      ctx.setup.push(`${cursor}=${el}.nextSibling;`);
      return;
    }

    case 'fragment': {
      emitHydrateChildren(node.children, ctx, cursor);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Simple template detection — single element with text/expression children
// e.g. <li>${text}</li>, <span>${a} ${b}</span>, <div class=${cls}>${x}</div>
// ---------------------------------------------------------------------------

interface SimpleTemplate {
  tag: string;
  staticAttrs: { name: string; value: string }[];
  dynamicAttrs: AttributeNode[];
  children: ASTNode[]; // text + expression nodes only
}

function isSimpleTemplate(ast: FragmentNode): SimpleTemplate | null {
  if (ast.children.length !== 1) return null;
  const root = ast.children[0];
  // Raw-text / RCDATA content is one text node built by the raw slot, not
  // appended child nodes.
  if (root.type !== 'element' || root.raw) return null;

  // Check children are only text/expression (no nested elements)
  for (const ch of root.children) {
    if (ch.type !== 'text' && ch.type !== 'expression') return null;
  }

  const staticAttrs: SimpleTemplate['staticAttrs'] = [];
  const dynamicAttrs: SimpleTemplate['dynamicAttrs'] = [];
  for (const a of root.attributes) {
    if (a.kind === 'static') staticAttrs.push({ name: a.name, value: a.value });
    else dynamicAttrs.push(a);
  }

  return { tag: root.tag, staticAttrs, dynamicAttrs, children: root.children };
}

function genSimpleTemplate(tpl: SimpleTemplate): string {
  assertSafeName(tpl.tag, 'tag');
  const setupParts: string[] = [];
  const reactiveParts: string[] = [];

  setupParts.push(`var _e=document.createElement(${jsString(tpl.tag)});`);

  // Static attributes
  for (const a of tpl.staticAttrs) {
    if (a.name === 'id' || a.name === 'class') {
      const prop = a.name === 'class' ? 'className' : 'id';
      setupParts.push(`_e.${prop}=${jsString(a.value)};`);
    } else {
      setupParts.push(`_e.setAttribute(${jsString(a.name)},${jsString(a.value || '')});`);
    }
  }

  // Dynamic attributes — folded into the shared watch where possible
  for (const a of tpl.dynamicAttrs) {
    const { setup, reactive } = genAttrBinding('_e', a, tpl.tag);
    if (setup) setupParts.push(setup);
    if (reactive) reactiveParts.push(reactive);
  }

  for (const ch of tpl.children) {
    if (ch.type === 'text') {
      if (ch.value !== '') {
        setupParts.push(`_e.appendChild(document.createTextNode(${jsString(ch.value)}));`);
      }
    } else if (ch.type === 'expression') {
      const val = `_v[${ch.index}]`;
      const id = bindVarCounter++;
      const xv = `_x${id}`;
      const tn = `_t${id}`;
      const fl = `_xf${id}`;
      // Text-slot value coercion MUST match valueToHtml() on the SSR side
      // (compiler/ssr-runtime.ts): null / undefined / false render as empty
      // string, everything else stringifies. The previous client path
      // skipped `=== false` in the reactive (function-call) branch AND in
      // the array-item branch — so a signal returning `false` produced
      // the literal text "false" on the client while SSR rendered nothing.
      // Symmetric `==null||===false` filter at every text-emit site.
      setupParts.push(
        `var ${xv}=_d?_d(${val}):${val};var ${fl}=typeof ${xv}==='function';`,
        `var ${tn}=_e.appendChild(document.createTextNode(''));if(!${fl})__purity_sw__(${tn},${xv});`,
      );
      reactiveParts.push(`if(${fl}){${slotUpdate(xv, tn)}}`);
    }
  }

  let body = setupParts.join('');
  if (reactiveParts.length > 0) {
    body += `_w(function(){${reactiveParts.join('')}});`;
  }
  body += 'return _e;';
  // codeql[js/code-injection] — see "Codegen safety contract" comment near
  // SAFE_NAME / assertSafeName at the top of this file. All names and
  // values spliced into `body` are regex-validated and/or JSON.stringify'd
  // before reaching this point; user input cannot escape the literal.
  return `function(_v,_w,_d){${body}}`;
}

// ---------------------------------------------------------------------------
// hasDynamic
// ---------------------------------------------------------------------------

function hasDynamic(node: ASTNode, customElements = false): boolean {
  if (node.type === 'expression') return true;
  // SSR must dispatch even static custom elements through the registry.
  if (
    node.type === 'element' &&
    ((customElements && node.tag.includes('-')) || node.attributes.some((a) => a.kind !== 'static'))
  )
    return true;
  return (
    (node.type === 'element' || node.type === 'fragment') &&
    node.children.some((child) => hasDynamic(child, customElements))
  );
}

// ---------------------------------------------------------------------------
// buildStaticHtml (no markers)
// ---------------------------------------------------------------------------

// The enclosing raw-content mode preserves raw text and encodes RCDATA CRs
// before HTML input preprocessing can normalize them.
function buildStaticHtml(node: ASTNode, rawParent?: ElementNode['raw']): string {
  switch (node.type) {
    case 'text': {
      // `raw: true` marks SGML declarations like `<!doctype html>` parsed
      // verbatim from the template; escaping would corrupt them.
      const text = node.raw || rawParent === 'text' ? node.value : escapeHtml(node.value);
      return rawParent === 'rcdata' ? text.replace(/\r/g, '&#13;') : text;
    }
    case 'comment':
      return `<!--${node.value.replace(/--!?>/g, '--&gt;')}-->`;
    case 'element': {
      assertSafeName(node.tag, 'tag');
      let s = `<${node.tag}`;
      for (const a of node.attributes) {
        if (a.kind === 'static') s += attrMarkup(a);
      }
      if (VOID.has(node.tag.toLowerCase())) return `${s}/>`;
      s += node.preserveLeadingNewline ? '>\n' : '>';
      for (const ch of node.children) s += buildStaticHtml(ch, node.raw);
      return `${s}</${node.tag}>`;
    }
    case 'fragment':
      return node.children.map((ch) => buildStaticHtml(ch)).join('');
    default:
      /* v8 ignore next -- defensive fallthrough; AST has no other types */
      return '';
  }
}

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
        `var ${id}=document.createTextNode(${jsString(node.value)});${parent}.appendChild(${id});`,
      );
      break;
    }
    case 'comment': {
      const id = `_n${counter.n++}`;
      stmts.push(
        `var ${id}=document.createComment(${jsString(node.value)});${parent}.appendChild(${id});`,
      );
      break;
    }
    case 'element': {
      assertSafeName(node.tag, 'tag');
      const id = `_n${counter.n++}`;
      const tag = node.tag.toLowerCase();
      const namespaceURI =
        'http://www.w3.org/' + (node.ns === 'svg' ? '2000/svg' : '1998/Math/MathML');
      stmts.push(
        `var ${id}=document.${node.ns ? `createElementNS(${jsString(namespaceURI)},` : 'createElement('}${jsString(node.tag)});`,
      );
      for (const a of node.attributes) {
        if (a.kind === 'static') {
          stmts.push(
            a.value
              ? `${id}.setAttribute(${jsString(a.name)},${jsString(a.value)});`
              : `${id}.setAttribute(${jsString(a.name)},'');`,
          );
        }
      }
      for (const ch of node.children) {
        genStaticDOM(ch, !node.ns && tag === 'template' ? `${id}.content` : id, stmts, counter);
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
    case 'comment':
      return buildStaticHtml(node);

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
          s += attrMarkup(a);
        } else {
          dynamicAttrs.push(a);
        }
      }

      if (dynamicAttrs.length > 0) {
        slots.push({ type: 'attr', tag: node.tag, attrs: dynamicAttrs, path: [...currentPath] });
      }

      if (VOID.has(node.tag.toLowerCase())) return `${s}/>`;
      s += node.preserveLeadingNewline ? '>\n' : '>';
      if (node.raw) {
        // Content is one text node: no placeholders inside. Static content is
        // serialized as-is (the open tag matches `s`: static attributes only);
        // dynamic content is written by the element's raw slot.
        if (!hasExpressionChild(node)) return buildStaticHtml(node);
        slots.push({ type: 'raw', children: node.children, path: [...currentPath] });
      } else {
        s += emitChildrenHtml(node.children, slots, currentPath);
      }
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
  // Cache paths used by multiple slots so cloned instances traverse them once.
  const prefixCounts = new Map<string, number>();
  for (const slot of slots) {
    let prefix = '';
    for (const step of slot.path) {
      prefix += step;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  // Locate every slot before a binding can replace a placeholder with nodes.
  const navigationParts: string[] = [];
  const sharedPaths = new Map<string, string>();
  const setupParts: string[] = [];
  const reactiveParts: string[] = [];

  for (const slot of slots) {
    let prefix = '';
    let nav = '_r';
    for (const step of slot.path) {
      prefix += step;
      nav += step === 0 ? '.firstChild' : '.nextSibling';
      if ((prefixCounts.get(prefix) ?? 0) > 1) {
        let cached = sharedPaths.get(prefix);
        if (cached === undefined) {
          cached = `_n${bindVarCounter++}`;
          navigationParts.push(`var ${cached}=${nav};`);
          sharedPaths.set(prefix, cached);
        }
        nav = cached;
      }
    }
    const nodeVar = sharedPaths.get(prefix) ?? `_n${bindVarCounter++}`;
    if (!sharedPaths.has(prefix)) navigationParts.push(`var ${nodeVar}=${nav};`);

    if (slot.type === 'expr') {
      const { setup, reactive } = genExprBinding(nodeVar, slot.index, slot.textPlaceholder);
      setupParts.push(setup);
      if (reactive) reactiveParts.push(reactive);
    } else if (slot.type === 'raw') {
      setupParts.push(
        rawContentBinding(nodeVar, slot.children, (i) => `_d?_d(_v[${i}]):_v[${i}]`, false),
      );
    } else {
      for (const attr of slot.attrs) {
        if (attr.kind !== 'static') {
          const { setup, reactive } = genAttrBinding(nodeVar, attr, slot.tag);
          setupParts.push(setup);
          if (reactive) reactiveParts.push(reactive);
        }
      }
    }
  }

  let result = navigationParts.join('') + setupParts.join('');
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

function genExprBinding(slotVar: string, index: number, _textPlaceholder: boolean): BindingParts {
  // The slot is always a Text node by the time the per-row factory runs:
  // - textPlaceholder=true: ZWSP text node stamped directly in the HTML.
  // - textPlaceholder=false: was a comment in the HTML, but converted to a
  //   Text node once at module init by genTemplateCommentToTextConversion.
  // So the setup is the same in both cases: function values keep the text
  // node and let the reactive watch write .data; Node/Array values do a
  // single replaceWith.
  const id = bindVarCounter++;
  const xv = `_xv${id}`;
  const tn = `_tn${id}`;
  const fl = `_f${id}`;
  const val = `_v[${index}]`;

  const setup =
    `var ${xv}=_d?_d(${val}):${val};var ${fl}=typeof ${xv}==='function';` +
    `var ${tn}=${slotVar};if(!${fl})__purity_sw__(${tn},${xv});`;

  const reactive = `if(${fl}){${slotUpdate(xv, tn)}}`;

  return { setup, reactive };
}

// ---------------------------------------------------------------------------
// Attribute binding (complex template path).
// Returns { setup, reactive }: same fold contract as genExprBinding.
// ---------------------------------------------------------------------------

function genAttrBinding(el: string, attr: AttributeNode, tag: string): BindingParts {
  if (attr.kind === 'static') return { setup: '', reactive: '' };
  assertSafeName(attr.name, 'attribute');
  assertSafeBinding(attr.name, attr.kind);

  const id = bindVarCounter++;
  const av = `_av${id}`;
  const fl = `_af${id}`;
  const val = `_v[${attr.index}]`;
  const qname = jsString(attr.name);
  // Custom-element properties are typed component data, not native URL sinks.
  const propertyValue = (expr: string): string =>
    tag.includes('-') ? expr : safeBindingValue(attr.name, expr);

  // Shared prefix of the value bindings: read the value once, note whether it
  // is an accessor (applied in the shared watch) or a static value.
  const head = `var ${av}=${val};var ${fl}=typeof ${av}==='function';`;

  switch (attr.kind) {
    case 'event':
      return { setup: `${el}.addEventListener(${qname},${val});`, reactive: '' };

    case 'dynamic': {
      const set = (x: string) =>
        `${el}.setAttribute(${qname},${x}===true?'':String(${safeBindingValue(attr.name, x)}));`;
      return {
        setup: `${head}if(!${fl}&&${av}!=null&&${av}!==false)${set(av)}`,
        reactive: `if(${fl}){var v${id}=${av}();if(v${id}==null||v${id}===false)${el}.removeAttribute(${qname});else ${set(`v${id}`)}}`,
      };
    }

    case 'bool':
      return {
        setup: `${head}if(!${fl}&&${av})${el}.setAttribute(${qname},'');`,
        reactive: `if(${fl}){if(${av}())${el}.setAttribute(${qname},'');else ${el}.removeAttribute(${qname});}`,
      };

    case 'prop':
    case 'reactive-prop':
      return {
        setup: `${head}if(!${fl})${el}[${qname}]=${propertyValue(av)};`,
        reactive: `if(${fl})${el}[${qname}]=${propertyValue(`${av}()`)};`,
      };

    case 'bind': {
      // Bind keeps its own watch — its reactive read is asymmetric (signal ->
      // element) AND it installs an event listener that writes the signal.
      // The setup includes both. Folding doesn't help here because the
      // listener is per-input.
      const evt = attr.name === 'checked' || attr.name === 'group' ? 'change' : 'input';
      const qevt = jsString(evt);
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
      // codeql[js/code-injection] — qname/qevt are JSON.stringify'd and
      // attr.name has passed assertSafeName. `el`/`val` are framework-
      // generated identifiers (`_n${id}`, `_v[${idx}]`), never user data.
      // See "Codegen safety contract" near SAFE_NAME.
      return {
        // codeql[js/bad-code-sanitization] -- qname is restricted by assertSafeName
        // to identifier characters; el/val are compiler-generated references.
        // No URL value or arbitrary HTML is interpolated into this source.
        setup: `if(typeof ${val}==='function'){_w(function(){${el}[${qname}]=${propertyValue(`${val}()`)};});${el}.addEventListener(${qevt},function(){${val}(${readSrc});});}`,
        reactive: '',
      };
    }

    default:
      /* v8 ignore next -- defensive fallthrough; parser only emits known kinds */
      return { setup: '', reactive: '' };
  }
}

// ---------------------------------------------------------------------------
// generateSSR(ast)
//
// Emits a factory `function (_v, _h) { var _o = ''; ...; return _o; }` that
// walks the same AST as generate() but produces an HTML string instead of DOM
// nodes. Used by @purityjs/ssr's renderToString.
//
// _h is the helpers bundle from ssr-runtime.ts (esc, attr, toHtml, toAttr).
// Branded `__purity_ssr_html__` results from nested templates and SSR
// control-flow helpers (eachSSR / whenSSR / matchSSR) concatenate raw via
// _h.toHtml.
//
// Reactive expression slots are wrapped in HYDRATION_OPEN / HYDRATION_CLOSE
// comment markers so the PR 4 hydrator can locate binding sites without
// path drift from HTML-parser text coalescing.
// ---------------------------------------------------------------------------

export function generateSSR(ast: FragmentNode): string {
  assertSafeScriptContent(ast);
  ast = condenseWhitespace(ast) as FragmentNode;
  const ctx: SSRGenCtx = { parts: [], counter: 0, out: '_o', spans: '_r', lastLitHtml: null };
  // Static-prefix optimization: if the entire tree is static AND contains no
  // hyphenated tags (which require runtime component dispatch), emit a closure
  // returning the prebuilt string. Avoids per-call work and skips the _v / _h
  // arguments entirely.
  if (!hasDynamic(ast, true)) {
    const html = buildStaticHtml(ast);
    // `html` is built by buildStaticHtml which assertSafeName-validates
    // tag/attr names and escapeHtml/escapeAttr-escapes text/attribute literals
    // from the parser. JSON.stringify wraps the result in a valid JS string
    // literal — the only interpolated value below. See "Codegen safety
    // contract" near SAFE_NAME at the top.
    // codeql[js/code-injection] — see "Codegen safety contract" near SAFE_NAME.
    return [
      '(function(){var _s;return function(_v,_h){return _s||(_s=_h.mark(',
      jsString(html),
      '));};})()',
    ].join('');
  }
  buildSSRBody(ast, ctx);
  // Every part appended to ctx.parts is either (a) a JSON.stringify'd string
  // literal, (b) a regex-validated identifier, or (c) a framework-internal
  // variable reference (`_v[N]`, `_av${id}`). See "Codegen safety contract"
  // near SAFE_NAME at the top.
  // codeql[js/code-injection] — see "Codegen safety contract" near SAFE_NAME.
  return ["function(_v,_h){var _o='',_r=[];", ctx.parts.join(''), 'return _h.mark(_o,_r);}'].join(
    '',
  );
}

export function generateSSRModule(ast: FragmentNode): string {
  return `export default ${generateSSR(ast)}`;
}

interface SSRGenCtx {
  parts: string[]; // JS source fragments that mutate the active output var
  counter: number; // unique-id counter for emitted local variables
  out: string; // current output variable name (default '_o', changes for slot capture)
  spans: string; // original raw-text spans belonging to the active output
  // Coalescing state: when the most recent push was a literal HTML append
  // (`_o+="…";`), track the raw HTML so we can extend the last entry without
  // re-parsing it out of the JS source. Reset whenever a non-literal part is
  // pushed. Previously this used a regex over `last`, which CodeQL flagged as
  // polynomial-redos — keeping the unstringified value side-by-side sidesteps
  // both the perf risk and the alert.
  lastLitHtml: string | null;
}

// Append a JS literal that adds a static HTML chunk to the active output var.
// Coalesces with the previous chunk if it also appends a literal to the same
// output var, keeping output compact.
function emitLit(ctx: SSRGenCtx, html: string): void {
  if (html === '') return;
  const prefix = `${ctx.out}+=`;
  if (ctx.lastLitHtml !== null) {
    const merged = ctx.lastLitHtml + html;
    ctx.parts[ctx.parts.length - 1] = `${prefix}${jsString(merged)};`;
    ctx.lastLitHtml = merged;
    return;
  }
  ctx.parts.push(`${prefix}${jsString(html)};`);
  ctx.lastLitHtml = html;
}

// Push a non-literal JS source fragment and invalidate the coalescing state.
// Use this anywhere `ctx.parts.push(...)` would otherwise have been called for
// non-literal code.
function pushRaw(ctx: SSRGenCtx, code: string): void {
  ctx.parts.push(code);
  ctx.lastLitHtml = null;
}

function buildSSRBody(node: ASTNode, ctx: SSRGenCtx): void {
  switch (node.type) {
    case 'text':
      // `raw: true` declarations (DOCTYPE, etc.) bypass the escape.
      emitLit(ctx, node.raw ? node.value : escapeHtml(node.value));
      return;

    case 'comment':
      emitLit(ctx, `<!--${node.value.replace(/--!?>/g, '--&gt;')}-->`);
      return;

    case 'expression': {
      // Reactive slot: wrapped in hydration markers so PR 4 can locate it.
      // _h.toHtml handles signal-accessor calls, branded HTML, arrays, and
      // primitive escaping in one place.
      emitLit(ctx, '<!--[-->');
      pushRaw(ctx, `${ctx.out}+=_h.toHtml(_v[${node.index}],${ctx.spans},${ctx.out}.length);`);
      emitLit(ctx, '<!--]-->');
      return;
    }

    case 'fragment':
      for (const ch of node.children) buildSSRBody(ch, ctx);
      return;

    case 'element': {
      assertSafeName(node.tag, 'tag');
      // Hyphenated tags route through _h.element, which dispatches to a
      // registered component (DSD-wrapped output) or falls back to plain
      // custom-element markup. PR 3 component SSR hangs off this path.
      if (node.tag.includes('-')) {
        emitCustomElement(node, ctx);
        return;
      }
      emitLit(ctx, `<${node.tag}`);
      for (const a of node.attributes) emitSSRAttr(a, ctx, node);
      if (VOID.has(node.tag.toLowerCase())) {
        emitLit(ctx, '/>');
        return;
      }
      emitLit(ctx, '>');
      if (node.preserveLeadingNewline) emitLit(ctx, '\n');
      if (node.raw) {
        // Raw-text / RCDATA content is one text node: no hydration markers
        // (they would become literal text), and the whole content is coerced
        // in one call so an end tag split across adjacent values (`</sty` +
        // `le>`) is still neutralised. Hydrate rebuilds the element's text.
        // Static raw text is the author's own source (dynamic <script> content
        // is rejected), so it is emitted as written.
        if (node.raw === 'text' && !hasExpressionChild(node)) {
          for (const ch of node.children) if (ch.type === 'text') emitLit(ctx, ch.value);
        } else {
          const parts = node.children.map((ch) => rawPart(ch, (i) => `_v[${i}]`));
          const spanArgs = `,undefined,${ctx.spans},${ctx.out}.length`;
          pushRaw(
            ctx,
            `${ctx.out}+=_h.rawText([${parts}]${node.raw === 'text' ? spanArgs : ',1'});`,
          );
        }
      } else {
        for (const ch of node.children) buildSSRBody(ch, ctx);
      }
      emitLit(ctx, `</${node.tag}>`);
      return;
    }
  }
}

// Custom-element emission: assemble props from non-event attributes, build the
// child slot HTML into a separate string, and dispatch through _h.element. The
// helper registers a renderer hook that @purityjs/ssr installs on import.
function emitCustomElement(node: import('./ast.ts').ElementNode, ctx: SSRGenCtx): void {
  const id = ctx.counter++;
  const attrsVar = `_attrs${id}`;
  const slotVar = `_slot${id}`;

  // Build attrs object literal — static + dynamic (events skipped server-side).
  // Static: literal value. Dynamic/prop/reactive-prop/bind: pass the raw value
  // (function or scalar); valueToAttr / the host renderer handles it.
  pushRaw(ctx, `var ${attrsVar}={};`);
  for (const a of node.attributes) {
    if (a.kind === 'static') {
      pushRaw(ctx, `${attrsVar}[${jsString(a.name)}]=${jsString(a.value)};`);
      continue;
    }
    if (a.kind === 'event') continue;
    assertSafeName(a.name, 'attribute');
    assertSafeBinding(a.name, a.kind);
    if (a.kind === 'bool') {
      // Boolean attribute: resolve any signal-accessor function and
      // coerce to a real boolean BEFORE handing it to the renderer.
      // valueToAttr only collapses `true → ''` (bare name); a truthy
      // non-boolean (e.g. `?disabled=${'yes'}`) would otherwise SSR as
      // `disabled="yes"` while the client setAttribute emits
      // `disabled=""` — a silent hydration mismatch. With the !! coerce,
      // both sides agree: truthy → bare name, falsy → omitted.
      const bv = `_b${a.index}`;
      pushRaw(
        ctx,
        `var ${bv}=_v[${a.index}];if(typeof ${bv}==='function')${bv}=${bv}();${attrsVar}[${jsString(a.name)}]=!!${bv};`,
      );
    } else {
      const val = `_v[${a.index}]`;
      const resolved =
        a.kind === 'dynamic' && URL_BINDINGS.has(a.name.toLowerCase())
          ? safeBindingValue(a.name, `(typeof ${val}==='function'?${val}():${val})`)
          : val;
      pushRaw(ctx, `${attrsVar}[${jsString(a.name)}]=${resolved};`);
    }
  }

  // Capture children into a slot string. Temporarily swap the active output
  // variable so all nested emissions append to slotVar; restore afterward.
  const slotSpans = `_sr${id}`;
  pushRaw(ctx, `var ${slotVar}='',${slotSpans}=[];`);
  const prevOut = ctx.out;
  const prevSpans = ctx.spans;
  ctx.out = slotVar;
  ctx.spans = slotSpans;
  for (const ch of node.children) buildSSRBody(ch, ctx);
  ctx.out = prevOut;
  ctx.spans = prevSpans;

  pushRaw(
    ctx,
    `${ctx.out}+=_h.element(${jsString(node.tag)},${attrsVar},${slotVar},${slotSpans},${ctx.spans},${ctx.out}.length);`,
  );
}

// DOM properties that do NOT reflect to a same-named HTML attribute. For
// `prop` / `reactive-prop` / `bind`, the client codegen assigns `_e[name]=value`
// (or, for these, writes child content). Emitting `name="value"` server-side is
// a no-op the browser never interprets as the property — worse for `innerHTML`,
// where the markup is HTML-escaped into a dead attribute. Skip them during SSR;
// the property assignment runs client-side at hydration. (Reflecting props such
// as `value` / `checked` / `selected` keep their existing attribute emission.)
const NON_REFLECTING_PROPS = /^(?:innerHTML|outerHTML|innerText|textContent)$/;

// A static attribute as markup, shared by the static, cloned and SSR paths.
function attrMarkup(a: import('./ast.ts').StaticAttribute): string {
  return a.value ? ` ${a.name}="${escapeAttr(a.value)}"` : ` ${a.name}`;
}

function emitSSRAttr(a: AttributeNode, ctx: SSRGenCtx, node: import('./ast.ts').ElementNode): void {
  if (a.kind === 'static') {
    emitLit(ctx, attrMarkup(a));
    return;
  }

  assertSafeName(a.name, 'attribute');
  assertSafeBinding(a.name, a.kind);
  const id = ctx.counter++;
  const av = `_av${id}`;
  const val = `_v[${a.index}]`;
  // Pre-escape the leading space + name once at codegen time. The trailing
  // `="..."` is appended at runtime so we can omit the attribute when the
  // value resolves to null/false.
  const namePrefix = jsString(` ${a.name}`);

  switch (a.kind) {
    case 'event':
      // Server has no listeners — skip entirely. The expression itself is
      // never evaluated, matching the client behavior of installing it via
      // addEventListener at hydration time (PR 4).
      return;

    case 'dynamic':
    case 'prop':
    case 'reactive-prop':
    case 'bind': {
      // `::group=${signal}` is radio/checkbox group binding, not an attribute.
      // The client sets `_e.checked` from `signal() === value` (radio) or
      // `signal().includes(value)` (checkbox). SSR has no such branch and
      // previously emitted a bogus `group="…"` attribute with no `checked`, so
      // the prerendered group showed no selection. Resolve it to a `checked`
      // attribute server-side using the element's static `type` + `value`.
      if (a.kind === 'bind' && a.name === 'group') {
        emitGroupBindSSR(a, ctx, node);
        return;
      }
      // Non-reflecting DOM properties (`.innerHTML`, `.textContent`, …) are
      // assigned as properties on the client; serializing them as attributes
      // is a no-op (and escapes markup into a dead attribute). Skip server-side
      // for the property-ish kinds — `dynamic` keeps true setAttribute semantics.
      if (a.kind !== 'dynamic' && NON_REFLECTING_PROPS.test(a.name)) return;
      // The remaining kinds read the current value (calling the accessor if
      // it's a function) and emit it as a quoted attribute. `bind` skips the
      // listener install — that's a hydration-time concern.
      const resolved = URL_BINDINGS.has(a.name.toLowerCase())
        ? safeBindingValue(a.name, `(typeof ${val}==='function'?${val}():${val})`)
        : val;
      pushRaw(ctx, `var ${av}=_h.toAttr(${resolved});`);
      pushRaw(ctx, `if(${av}!==null)${ctx.out}+=${namePrefix}+(${av}===''?'':'="'+${av}+'"');`);
      return;
    }

    case 'bool': {
      // Boolean attribute: present (no value) when truthy, absent otherwise.
      pushRaw(ctx, `var ${av}=${val};if(typeof ${av}==='function')${av}=${av}();`);
      pushRaw(ctx, `if(${av})${ctx.out}+=${namePrefix};`);
      return;
    }

    /* v8 ignore next 2 -- defensive fallthrough; parser only emits known kinds */
    default:
      return;
  }
}

/**
 * SSR for `::group=${signal}` radio/checkbox binding. Mirrors the client setup
 * (codegen.ts `bind` case, `name === 'group'`): emits a bare `checked`
 * attribute when the signal currently selects this input, and never emits the
 * non-existent `group` attribute. Radio vs checkbox is decided from the static
 * `type` attribute, and the comparison value from the static `value` attribute.
 * When either is dynamic / absent the server can't resolve selection — it omits
 * `checked` and lets hydration set it client-side (no bogus attribute either way).
 */
function emitGroupBindSSR(
  a: import('./ast.ts').BindAttribute,
  ctx: SSRGenCtx,
  node: import('./ast.ts').ElementNode,
): void {
  const staticAttr = (name: string): string | null => {
    for (const attr of node.attributes) {
      if (attr.name === name) return attr.kind === 'static' ? attr.value : null;
    }
    return null;
  };
  const type = staticAttr('type');
  const value = staticAttr('value');
  // Need a concrete value to compare the signal against. Checkbox membership and
  // radio equality both read it; without it, defer entirely to client hydration.
  if (value === null) return;

  const id = ctx.counter++;
  const gv = `_g${id}`;
  const qval = jsString(value);
  // Resolve the signal (call accessor if function) once.
  pushRaw(ctx, `var ${gv}=${`_v[${a.index}]`};if(typeof ${gv}==='function')${gv}=${gv}();`);
  const selected =
    type === 'radio'
      ? `${gv}===${qval}`
      : // checkbox (default for ::group when not explicitly radio): membership.
        `${gv}!=null&&typeof ${gv}.includes==='function'&&${gv}.includes(${qval})`;
  pushRaw(ctx, `if(${selected})${ctx.out}+=" checked";`);
}
