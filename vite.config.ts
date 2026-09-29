import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    useTabs: false,
    tabWidth: 2,
    printWidth: 100,
    singleQuote: true,
    jsxSingleQuote: false,
    quoteProps: 'as-needed',
    trailingComma: 'all',
    semi: true,
    arrowParens: 'always',
    bracketSameLine: false,
    bracketSpacing: true,
    embeddedLanguageFormatting: 'off',
    ignorePatterns: ['**/dist/**', '**/node_modules/**', 'gh-pages/**', '**/.claude/**'],
  },
  lint: {
    plugins: ['typescript', 'oxc', 'vue'],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
      perf: 'off',
      style: 'off',
      pedantic: 'off',
      restriction: 'off',
      nursery: 'off',
    },
    rules: {
      'typescript/no-explicit-any': 'off',
      'typescript/no-non-null-assertion': 'off',
      'no-underscore-dangle': 'off',
    },
    ignorePatterns: [
      '**/dist/**',
      '**/node_modules/**',
      'gh-pages/**',
      'benchmark/history/**',
      'benchmark/results/**',
    ],
    overrides: [
      {
        files: ['benchmark/**'],
        rules: {
          'no-unused-vars': 'off',
          'no-unused-expressions': 'off',
          'no-shadow': 'off',
          'typescript/no-unused-vars': 'off',
        },
      },
      {
        files: ['**/tests/**', '**/*.test.ts'],
        rules: {
          'no-unused-expressions': 'off',
          'no-shadow': 'off',
          'oxc/erasing-op': 'off',
        },
      },
    ],
  },
});
