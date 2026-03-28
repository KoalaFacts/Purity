import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: [
    { file: 'dist/index.js', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs', format: 'cjs', sourcemap: true },
  ],
  external: [/^@purity\//],
  plugins: [
    resolve(),
    typescript({ declaration: true, declarationDir: 'dist' }),
  ],
};
