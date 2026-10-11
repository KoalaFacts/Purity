// ---------------------------------------------------------------------------
// Purity Compiler — AST Node Types
//
// The AST represents a parsed template. The codegen phase transforms
// these nodes into optimized DOM creation code.
// ---------------------------------------------------------------------------

export type ASTNode = ElementNode | TextNode | ExpressionNode | CommentNode | FragmentNode;

/** HTML void elements, shared by parsing, codegen, and SSR text extraction. */
export const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);

export interface FragmentNode {
  type: 'fragment';
  children: ASTNode[];
}

export interface ElementNode {
  type: 'element';
  tag: string;
  attributes: AttributeNode[];
  children: ASTNode[];
  /** HTML void element or self-closing foreign element; serialized without children. */
  isVoid: boolean;
  /** Foreign namespace determined by the parser; omitted for HTML elements. */
  ns?: 'svg' | 'math';
  /**
   * Set by the parser on an HTML-namespace raw-text (`'text'`: style, script)
   * or RCDATA (`'rcdata'`: textarea, title) element, whose content the HTML
   * parser reads as one text node. Unset for SVG/MathML elements of the same
   * name, which parse their content as markup.
   */
  raw?: 'text' | 'rcdata';
  /** Compensate for the HTML parser consuming one initial LF. */
  preserveLeadingNewline?: boolean;
}

export interface TextNode {
  type: 'text';
  value: string;
  /**
   * When true the text is emitted byte-for-byte without HTML escaping
   * (SSR) and without text-node coercion (client DOM build). Used for
   * SGML-style declarations like `<!doctype html>` parsed verbatim from
   * the template — escaping would corrupt the doctype.
   */
  raw?: boolean;
}

export interface ExpressionNode {
  type: 'expression';
  index: number; // index into the values array
}

export interface CommentNode {
  type: 'comment';
  value: string;
}

// ---------------------------------------------------------------------------
// Attribute types
// ---------------------------------------------------------------------------

export type AttributeNode =
  | StaticAttribute
  | DynamicAttribute
  | EventAttribute
  | BoolAttribute
  | BindAttribute
  | PropAttribute
  | ReactivePropAttribute;

interface BaseAttribute {
  name: string;
  /** Namespace of an HTML-parser-adjusted foreign attribute. */
  ns?: string;
}

export interface StaticAttribute extends BaseAttribute {
  kind: 'static';
  value: string;
}

export interface DynamicAttribute extends BaseAttribute {
  kind: 'dynamic';
  index: number; // expression index
}

export interface EventAttribute extends BaseAttribute {
  kind: 'event';
  index: number;
}

export interface BoolAttribute extends BaseAttribute {
  kind: 'bool';
  index: number;
}

export interface BindAttribute extends BaseAttribute {
  kind: 'bind';
  index: number;
}

export interface PropAttribute extends BaseAttribute {
  kind: 'prop';
  index: number;
}

export interface ReactivePropAttribute extends BaseAttribute {
  kind: 'reactive-prop';
  index: number;
}
