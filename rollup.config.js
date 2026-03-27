import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/purity.js',
      format: 'es',
      sourcemap: true,
    },
    {
      file: 'dist/purity.cjs',
      format: 'cjs',
      sourcemap: true,
    },
  ],
  plugins: [
    resolve(),
    typescript({
      declaration: true,
      declarationDir: 'dist',
    }),
  ],
};
