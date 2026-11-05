import { describe, expect, it } from 'vite-plus/test';
import * as compilerPackage from '@purityjs/compiler';
import * as signalsPackage from '@purityjs/signals';
import * as compilerSource from '../../compiler/src/index.ts';
import * as signalsSource from '../../signals/src/index.ts';
import { batch, compute, state, watch } from '../src/index.ts';

// CQ-06: core's suite must exercise sibling packages' source, not a previous
// `dist` build, so an edit to codegen.ts is tested by `npm test -w packages/core`.
describe('core tests resolve sibling packages to source', () => {
  it('resolves @purityjs/compiler to packages/compiler/src', () => {
    expect(compilerPackage.generate).toBe(compilerSource.generate);
    expect(compilerPackage.parse).toBe(compilerSource.parse);
  });

  it('resolves @purityjs/signals to packages/signals/src', () => {
    expect(signalsPackage.state).toBe(signalsSource.state);
  });
});

// CQ-07: the signal graph's own suite lives in packages/signals/tests; core only
// pins that its public entry re-exports the same functions.
describe('core re-exports the signals primitives', () => {
  it('exposes the @purityjs/signals implementations unchanged', () => {
    expect(state).toBe(signalsPackage.state);
    expect(compute).toBe(signalsPackage.compute);
    expect(watch).toBe(signalsPackage.watch);
    expect(batch).toBe(signalsPackage.batch);
  });
});
