import resolve from '@rollup/plugin-node-resolve';

export default {
  input: 'src/index.js',
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
  plugins: [resolve()],
};
