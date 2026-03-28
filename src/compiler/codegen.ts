// ---------------------------------------------------------------------------
// Purity Compiler — Code Generator
//
// Transforms AST into optimized JavaScript code that creates DOM directly.
// No runtime template parsing, no TreeWalker, no marker comments.
//
// Output is a function body that:
// 1. Creates all DOM elements with document.createElement
// 2. Sets static attributes inline
// 3. Creates Text nodes for static text
// 4. Wraps reactive bindings in watch() calls
// 5. Returns the root node or fragment
// ---------------------------------------------------------------------------

import type {
  ASTNode,
  AttributeNode,
  ElementNode,
  ExpressionNode,
  FragmentNode,
  TextNode,
} from './ast.js';

interface CodegenContext {
  code: string[]; // lines of generated code
  varCounter: number; // unique variable counter
  indent: number; // current indentation level
}

function ctx(): CodegenContext {
  return { code: [], varCounter: 0, indent: 1 };
}

function nextVar(c: CodegenContext, prefix: string): string {
  return `_${prefix}${c.varCounter++}`;
}

function emit(c: CodegenContext, line: string): void {
  c.code.push('  '.repeat(c.indent) + line);
}

// ---------------------------------------------------------------------------
// generate(ast) — produces a function string from AST
//
// Returns a string like:
//   function(__values, __watch) {
//     const _el0 = document.createElement('div');
//     ...
//     return _el0;
//   }
// ---------------------------------------------------------------------------

export function generate(ast: FragmentNode): string {
  const c = ctx();

  if (ast.children.length === 0) {
    return 'function(__values, __watch) { return document.createDocumentFragment(); }';
  }

  if (ast.children.length === 1) {
    const rootVar = genNode(c, ast.children[0]);
    emit(c, `return ${rootVar};`);
  } else {
    const fragVar = nextVar(c, 'f');
    emit(c, `const ${fragVar} = document.createDocumentFragment();`);
    for (const child of ast.children) {
      const childVar = genNode(c, child);
      emit(c, `${fragVar}.appendChild(${childVar});`);
    }
    emit(c, `return ${fragVar};`);
  }

  return `function(__values, __watch) {\n${c.code.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// generateModule(ast) — produces an ES module string for Vite plugin
//
// import { watch } from 'purity';
// export default function(values) { ... }
// ---------------------------------------------------------------------------

export function generateModule(ast: FragmentNode): string {
  const c = ctx();

  if (ast.children.length === 0) {
    return [
      'export default function(__values, __watch) {',
      '  return document.createDocumentFragment();',
      '}',
    ].join('\n');
  }

  if (ast.children.length === 1) {
    const rootVar = genNode(c, ast.children[0]);
    emit(c, `return ${rootVar};`);
  } else {
    const fragVar = nextVar(c, 'f');
    emit(c, `const ${fragVar} = document.createDocumentFragment();`);
    for (const child of ast.children) {
      const childVar = genNode(c, child);
      emit(c, `${fragVar}.appendChild(${childVar});`);
    }
    emit(c, `return ${fragVar};`);
  }

  return `export default function(__values, __watch) {\n${c.code.join('\n')}\n}`;
}

// ---------------------------------------------------------------------------
// Node generators — return the variable name holding the created node
// ---------------------------------------------------------------------------

function genNode(c: CodegenContext, node: ASTNode): string {
  switch (node.type) {
    case 'element':
      return genElement(c, node);
    case 'text':
      return genText(c, node);
    case 'expression':
      return genExpression(c, node);
    case 'comment':
      return genComment(c, node);
    case 'fragment':
      return genFragment(c, node);
  }
}

function genElement(c: CodegenContext, node: ElementNode): string {
  const v = nextVar(c, 'e');
  emit(c, `const ${v} = document.createElement('${node.tag}');`);

  // Attributes
  for (const attr of node.attributes) {
    genAttribute(c, v, attr);
  }

  // Children
  for (const child of node.children) {
    const childVar = genNode(c, child);
    emit(c, `${v}.appendChild(${childVar});`);
  }

  return v;
}

function genText(c: CodegenContext, node: TextNode): string {
  // Skip pure whitespace nodes between elements
  if (!node.value.trim()) {
    const v = nextVar(c, 't');
    emit(c, `const ${v} = document.createTextNode(${JSON.stringify(node.value)});`);
    return v;
  }

  const v = nextVar(c, 't');
  emit(c, `const ${v} = document.createTextNode(${JSON.stringify(node.value)});`);
  return v;
}

function genExpression(c: CodegenContext, node: ExpressionNode): string {
  const v = nextVar(c, 'x');
  const valExpr = `__values[${node.index}]`;

  // Content expression — could be static value, function (reactive), or Node
  emit(c, `const ${v} = document.createTextNode('');`);
  emit(c, `const ${v}_val = ${valExpr};`);
  emit(c, `if (typeof ${v}_val === 'function') {`);
  emit(c, `  __watch(() => {`);
  emit(c, `    const _r = ${v}_val();`);
  emit(c, `    if (_r instanceof Node) { ${v}.replaceWith(_r); }`);
  emit(c, `    else { ${v}.data = _r == null ? '' : String(_r); }`);
  emit(c, `  });`);
  emit(c, `} else if (${v}_val instanceof Node) {`);
  emit(c, `  ${v}.replaceWith(${v}_val);`);
  emit(c, `} else if (${v}_val != null && ${v}_val !== false) {`);
  emit(c, `  ${v}.data = String(${v}_val);`);
  emit(c, `}`);

  return v;
}

function genComment(c: CodegenContext, node: { value: string }): string {
  const v = nextVar(c, 'c');
  emit(c, `const ${v} = document.createComment(${JSON.stringify(node.value)});`);
  return v;
}

function genFragment(c: CodegenContext, node: FragmentNode): string {
  const v = nextVar(c, 'f');
  emit(c, `const ${v} = document.createDocumentFragment();`);
  for (const child of node.children) {
    const childVar = genNode(c, child);
    emit(c, `${v}.appendChild(${childVar});`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Attribute code generation
// ---------------------------------------------------------------------------

function genAttribute(c: CodegenContext, elVar: string, attr: AttributeNode): void {
  switch (attr.kind) {
    case 'static':
      if (attr.value) {
        emit(c, `${elVar}.setAttribute('${attr.name}', ${JSON.stringify(attr.value)});`);
      } else {
        emit(c, `${elVar}.setAttribute('${attr.name}', '');`);
      }
      break;

    case 'dynamic': {
      const val = `__values[${attr.index}]`;
      emit(c, `if (typeof ${val} === 'function') {`);
      emit(c, `  __watch(() => {`);
      emit(c, `    const _v = ${val}();`);
      emit(c, `    if (_v == null || _v === false) ${elVar}.removeAttribute('${attr.name}');`);
      emit(c, `    else ${elVar}.setAttribute('${attr.name}', String(_v));`);
      emit(c, `  });`);
      emit(c, `} else if (${val} != null && ${val} !== false) {`);
      emit(c, `  ${elVar}.setAttribute('${attr.name}', String(${val}));`);
      emit(c, `}`);
      break;
    }

    case 'event':
      emit(c, `${elVar}.addEventListener('${attr.name}', __values[${attr.index}]);`);
      emit(c, `${elVar}.__purity_event_${attr.name} = __values[${attr.index}];`);
      break;

    case 'bool': {
      const val = `__values[${attr.index}]`;
      emit(c, `if (typeof ${val} === 'function') {`);
      emit(c, `  __watch(() => {`);
      emit(c, `    if (${val}()) ${elVar}.setAttribute('${attr.name}', '');`);
      emit(c, `    else ${elVar}.removeAttribute('${attr.name}');`);
      emit(c, `  });`);
      emit(c, `} else if (${val}) {`);
      emit(c, `  ${elVar}.setAttribute('${attr.name}', '');`);
      emit(c, `}`);
      break;
    }

    case 'prop': {
      const val = `__values[${attr.index}]`;
      emit(c, `if (typeof ${val} === 'function') {`);
      emit(c, `  __watch(() => { ${elVar}.${attr.name} = ${val}(); });`);
      emit(c, `} else {`);
      emit(c, `  ${elVar}.${attr.name} = ${val};`);
      emit(c, `}`);
      break;
    }

    case 'reactive-prop': {
      const val = `__values[${attr.index}]`;
      emit(c, `if (typeof ${val} === 'function') {`);
      emit(c, `  __watch(() => { ${elVar}['${attr.name}'] = ${val}(); });`);
      emit(c, `} else {`);
      emit(c, `  ${elVar}['${attr.name}'] = ${val};`);
      emit(c, `}`);
      break;
    }

    case 'bind': {
      const val = `__values[${attr.index}]`;
      const evtName = attr.name === 'checked' || attr.name === 'group' ? 'change' : 'input';
      emit(c, `if (typeof ${val} === 'function') {`);
      if (attr.name === 'group') {
        emit(c, `  if (${elVar}.type === 'radio') {`);
        emit(c, `    __watch(() => { ${elVar}.checked = ${val}() === ${elVar}.value; });`);
        emit(
          c,
          `    ${elVar}.addEventListener('change', () => { if (${elVar}.checked) ${val}(${elVar}.value); });`,
        );
        emit(c, `  } else {`);
        emit(c, `    __watch(() => { ${elVar}.checked = ${val}().includes(${elVar}.value); });`);
        emit(c, `    ${elVar}.addEventListener('change', () => {`);
        emit(c, `      const _a = [...${val}()]; const _i = _a.indexOf(${elVar}.value);`);
        emit(c, `      if (${elVar}.checked) { if (_i === -1) _a.push(${elVar}.value); }`);
        emit(c, `      else if (_i !== -1) { _a.splice(_i, 1); }`);
        emit(c, `      ${val}(_a);`);
        emit(c, `    });`);
        emit(c, `  }`);
      } else {
        emit(c, `  __watch(() => { ${elVar}['${attr.name}'] = ${val}(); });`);
        emit(
          c,
          `  ${elVar}.addEventListener('${evtName}', () => { ${val}(${attr.name === 'checked' ? `${elVar}.checked` : `${elVar}['${attr.name}']`}); });`,
        );
      }
      emit(c, `}`);
      break;
    }
  }
}
