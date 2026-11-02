import { describe, expect, it } from 'vite-plus/test';
import * as compiler from '@purityjs/compiler';
import * as runtime from '../src/runtime.ts';

describe('shared compiler and SSR lexical helpers', () => {
  it('uses the same escaping, namespace and raw-text implementations', () => {
    expect(runtime.escHtml).toBe(compiler.escHtml);
    expect(runtime.escAttr).toBe(compiler.escAttr);
    expect(runtime.elementNamespace).toBe(compiler.elementNamespace);
    expect(runtime.childNamespace).toBe(compiler.childNamespace);
    expect(runtime.rawEnd).toBe(compiler.rawEnd);
  });
});
