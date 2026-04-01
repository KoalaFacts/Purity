export interface PurityPluginOptions {
  include?: string[];
}

export function purity(options?: PurityPluginOptions): {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
};

export default purity;
