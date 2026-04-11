declare module "@purityjs/core/compiler" {
  export interface FragmentNode {
    type: "fragment";
    children: unknown[];
  }

  export function parse(strings: readonly string[]): FragmentNode;
  export function generate(ast: FragmentNode): string;
  export function generateModule(ast: FragmentNode): string;
}
