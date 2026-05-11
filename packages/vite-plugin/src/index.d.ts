export interface PurityPluginOptions {
  include?: string[];
}

export interface PuritySourceMap {
  version: 3;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export function purity(options?: PurityPluginOptions): {
  name: string;
  enforce: 'pre';
  transform(this: any, code: string, id: string): { code: string; map: PuritySourceMap } | null;
};

export default purity;
