// ---------------------------------------------------------------------------
// Purity Compiler — Template Parser
//
// Parses the static strings from a tagged template literal into an AST.
// Expression positions are tracked by index (matching the values array).
//
// This parser is designed for speed:
// - Single pass, no regex for main parsing loop
// - CharCode comparisons instead of string methods
// - Minimal allocations — reuses state variables
// ---------------------------------------------------------------------------

import type { ASTNode, AttributeNode, ElementNode, FragmentNode } from './ast.ts';

// Void elements that cannot have children
const VOID_TAGS = new Set([
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

// Char codes for fast comparison
const LT = 60; // <
const GT = 62; // >
const SLASH = 47; // /
const BANG = 33; // !
const DASH = 45; // -
const EQ = 61; // =
const QUOTE = 34; // "
const APOS = 39; // '
const AT = 64; // @
const QMARK = 63; // ?
const DOT = 46; // .
const COLON = 58; // :
const SPACE = 32;
const TAB = 9;
const NL = 10;
const CR = 13;

function isWhitespace(c: number): boolean {
  return c === SPACE || c === TAB || c === NL || c === CR;
}

function isAlpha(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAlphaNumeric(c: number): boolean {
  return isAlpha(c) || (c >= 48 && c <= 57);
}

function isNameChar(c: number): boolean {
  return isAlphaNumeric(c) || c === DASH || c === DOT || c === 95 /* _ */ || c === COLON;
}

// ---------------------------------------------------------------------------
// parse(strings) — parse template strings into AST
//
// `strings` is the TemplateStringsArray from html`...`.
// Expression boundaries are between strings[i] and strings[i+1].
// ---------------------------------------------------------------------------

export function parse(strings: readonly string[]): FragmentNode {
  const parser = new Parser(strings);
  return parser.parse();
}

class Parser {
  private strings: readonly string[];
  private strIdx = 0; // current string index
  private pos = 0; // position within current string
  private exprIndex = 0; // next expression index

  constructor(strings: readonly string[]) {
    this.strings = strings;
  }

  // Current char code, or -1 if at expression boundary or end
  private peek(): number {
    const s = this.strings[this.strIdx];
    if (this.pos >= s.length) return -1;
    return s.charCodeAt(this.pos);
  }

  private advance(): void {
    this.pos++;
  }

  private current(): string {
    return this.strings[this.strIdx];
  }

  // Are we at the boundary between two template strings (expression position)?
  private atExprBoundary(): boolean {
    return this.pos >= this.strings[this.strIdx].length && this.strIdx < this.strings.length - 1;
  }

  // Consume the expression boundary, returning the expression index
  private consumeExpr(): number {
    const idx = this.exprIndex++;
    this.strIdx++;
    this.pos = 0;
    return idx;
  }

  private atEnd(): boolean {
    return this.strIdx >= this.strings.length - 1 && this.pos >= this.strings[this.strIdx].length;
  }

  private skipWhitespace(): void {
    while (!this.atEnd()) {
      if (this.atExprBoundary()) break;
      const c = this.peek();
      if (c === -1 || !isWhitespace(c)) break;
      this.advance();
    }
  }

  // Read until a char code, returning the collected string
  private readUntil(stop: number): string {
    const s = this.current();
    const start = this.pos;
    while (this.pos < s.length && s.charCodeAt(this.pos) !== stop) {
      this.pos++;
    }
    return s.slice(start, this.pos);
  }

  // Read a name (tag name, attribute name)
  private readName(): string {
    const s = this.current();
    const start = this.pos;
    while (this.pos < s.length && isNameChar(s.charCodeAt(this.pos))) {
      this.pos++;
    }
    return s.slice(start, this.pos);
  }

  parse(): FragmentNode {
    const children = this.parseChildren();
    return { type: 'fragment', children };
  }

  private parseChildren(): ASTNode[] {
    const children: ASTNode[] = [];

    while (!this.atEnd()) {
      if (this.atExprBoundary()) {
        // Expression in content position
        children.push({ type: 'expression', index: this.consumeExpr() });
        continue;
      }

      const c = this.peek();

      if (c === LT) {
        // Could be: opening tag, closing tag, or comment
        const s = this.current();

        // Closing tag — stop and let parent handle it
        if (this.pos + 1 < s.length && s.charCodeAt(this.pos + 1) === SLASH) {
          break;
        }

        // Comment
        if (
          this.pos + 3 < s.length &&
          s.charCodeAt(this.pos + 1) === BANG &&
          s.charCodeAt(this.pos + 2) === DASH &&
          s.charCodeAt(this.pos + 3) === DASH
        ) {
          children.push(this.parseComment());
          continue;
        }

        // SGML-style declaration: `<!doctype ...>`, `<![CDATA[...]]>`, etc.
        // Captured verbatim so SSR codegen can emit the original bytes
        // (DOCTYPE is the common case — letting a template literal start
        // with `<!doctype html>` is the obvious way to ship a full HTML
        // document from a single `html\`\`` template). Without this we
        // fall through to `parseElement`, where `readName()` can't
        // consume `!` and `parseAttribute()` spins forever (no advance).
        if (this.pos + 1 < s.length && s.charCodeAt(this.pos + 1) === BANG) {
          children.push(this.parseDeclaration());
          continue;
        }

        // Opening tag
        children.push(this.parseElement());
        continue;
      }

      // Text content
      children.push(this.parseText());
    }

    return children;
  }

  private parseText(): ASTNode {
    const s = this.current();
    const start = this.pos;
    while (this.pos < s.length && s.charCodeAt(this.pos) !== LT) {
      this.pos++;
    }
    const value = s.slice(start, this.pos);
    return { type: 'text', value };
  }

  private parseDeclaration(): ASTNode {
    // Skip `<!`
    this.pos += 2;
    const s = this.current();
    const start = this.pos;
    // Scan for `>` — declarations don't nest, so first `>` wins.
    while (this.pos < s.length && s.charCodeAt(this.pos) !== GT) {
      this.pos++;
    }
    const body = s.slice(start, this.pos);
    if (this.pos < s.length) this.pos++; // consume `>`
    // Re-emit as a raw text node — bytes flow through codegen unescaped
    // so `<!doctype html>` survives intact. `raw` is the discriminator.
    return { type: 'text', value: `<!${body}>`, raw: true };
  }

  private parseComment(): ASTNode {
    // Skip <!--
    this.pos += 4;
    const s = this.current();
    const start = this.pos;
    // Find -->
    const endIdx = s.indexOf('-->', this.pos);
    if (endIdx === -1) {
      this.pos = s.length;
      return { type: 'comment', value: s.slice(start) };
    }
    this.pos = endIdx + 3;
    return { type: 'comment', value: s.slice(start, endIdx) };
  }

  private parseElement(): ElementNode {
    // Skip <
    this.advance();

    // Tag name
    const tag = this.readName();
    const attributes = this.parseAttributes();

    // Self-closing or void?
    this.skipWhitespace();

    let selfClosing = false;
    if (!this.atEnd() && !this.atExprBoundary() && this.peek() === SLASH) {
      selfClosing = true;
      this.advance();
    }

    // Skip >
    if (!this.atEnd() && !this.atExprBoundary() && this.peek() === GT) {
      this.advance();
    }

    const isVoid = VOID_TAGS.has(tag) || selfClosing;

    let children: ASTNode[] = [];
    if (!isVoid) {
      children = this.parseChildren();
      // Consume closing tag </tag>
      this.consumeClosingTag(tag);
    }

    return { type: 'element', tag, attributes, children, isVoid };
  }

  private consumeClosingTag(_tag: string): void {
    const s = this.current();
    // Expect </tagname>
    if (
      this.pos + 1 < s.length &&
      s.charCodeAt(this.pos) === LT &&
      s.charCodeAt(this.pos + 1) === SLASH
    ) {
      this.pos += 2;
      // Skip tag name
      this.readName();
      // Skip whitespace
      this.skipWhitespace();
      // Skip >
      if (!this.atEnd() && !this.atExprBoundary() && this.peek() === GT) {
        this.advance();
      }
    }
  }

  private parseAttributes(): AttributeNode[] {
    const attrs: AttributeNode[] = [];

    while (true) {
      this.skipWhitespace();

      if (this.atEnd()) break;
      if (this.atExprBoundary()) break;

      const c = this.peek();
      if (c === GT || c === SLASH || c === -1) break;

      attrs.push(this.parseAttribute());
    }

    return attrs;
  }

  private parseAttribute(): AttributeNode {
    const s = this.current();
    const startPos = this.pos;
    const firstChar = s.charCodeAt(this.pos);

    // Detect prefix: @event, ?bool, .prop, ::two-way, :one-way
    let prefix = '';
    if (firstChar === AT || firstChar === QMARK || firstChar === DOT) {
      prefix = s[this.pos];
      this.advance();
    } else if (firstChar === COLON) {
      // Check for :: (two-way) vs : (one-way)
      if (this.pos + 1 < s.length && s.charCodeAt(this.pos + 1) === COLON) {
        prefix = '::';
        this.pos += 2;
      } else {
        prefix = ':';
        this.advance();
      }
    }

    // Read attribute name
    const name = this.readName();

    // Defensive guard: if we couldn't make progress AND there's no
    // prefix that already advanced us, skip one char so the
    // `parseAttributes()` loop terminates. Without this, an
    // unrecognized character at attribute position (e.g. `<!doctype>`
    // mistakenly routed to parseElement before the declaration
    // handler shipped) would spin forever.
    if (name === '' && prefix === '' && this.pos === startPos) {
      if (!this.atEnd() && !this.atExprBoundary()) this.advance();
      return { kind: 'static', name: '', value: '' };
    }

    // Check for = (value assignment)
    this.skipWhitespace();

    if (this.atEnd() || this.atExprBoundary() || this.peek() !== EQ) {
      // Boolean attribute with no value: <input disabled>
      return { kind: 'static', name, value: '' };
    }

    // Skip =
    this.advance();

    // Skip optional quote
    this.skipWhitespace();
    let quoteChar = 0;
    if (!this.atEnd() && !this.atExprBoundary()) {
      const qc = this.peek();
      if (qc === QUOTE || qc === APOS) {
        quoteChar = qc;
        this.advance();
      }
    }

    // Check if value is an expression
    if (this.atExprBoundary()) {
      const exprIdx = this.consumeExpr();

      // Skip closing quote if present
      if (quoteChar && !this.atEnd() && !this.atExprBoundary() && this.peek() === quoteChar) {
        this.advance();
      }

      return this.classifyDynamicAttr(prefix, name, exprIdx);
    }

    // Static value
    let value: string;
    if (quoteChar) {
      value = this.readUntil(quoteChar);
      if (!this.atEnd() && !this.atExprBoundary() && this.peek() === quoteChar) {
        this.advance();
      }
    } else {
      // Unquoted — read until whitespace or >
      const start = this.pos;
      while (
        this.pos < s.length &&
        !isWhitespace(s.charCodeAt(this.pos)) &&
        s.charCodeAt(this.pos) !== GT &&
        s.charCodeAt(this.pos) !== SLASH
      ) {
        this.pos++;
      }
      value = s.slice(start, this.pos);
    }

    return { kind: 'static', name, value };
  }

  private classifyDynamicAttr(prefix: string, name: string, index: number): AttributeNode {
    switch (prefix) {
      case '@':
        return { kind: 'event', name, index };
      case '?':
        return { kind: 'bool', name, index };
      case '.':
        return { kind: 'prop', name, index };
      case ':':
        return { kind: 'reactive-prop', name, index };
      case '::':
        return { kind: 'bind', name, index };
      default:
        return { kind: 'dynamic', name, index };
    }
  }
}
