// ---------------------------------------------------------------------------
// Purity Compiler — AST Node Types
//
// The AST represents a parsed template. The codegen phase transforms
// these nodes into optimized DOM creation code.
// ---------------------------------------------------------------------------

export type ASTNode = ElementNode | TextNode | ExpressionNode | CommentNode | FragmentNode;

export interface FragmentNode {
  type: 'fragment';
  children: ASTNode[];
}

export interface ElementNode {
  type: 'element';
  tag: string;
  attributes: AttributeNode[];
  children: ASTNode[];
  isVoid: boolean; // <br>, <input>, etc.
}

export interface TextNode {
  type: 'text';
  value: string;
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
