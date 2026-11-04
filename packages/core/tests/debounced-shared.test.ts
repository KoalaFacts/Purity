import { describe, expect, it } from 'vite-plus/test';
import { debounced as signalsDebounced, state } from '@purityjs/signals';
import { debounced as coreDebounced, type DebouncedAccessor } from '../src/debounced.ts';
import { debounced as csrDebounced } from '../src/csr.ts';
import { debounced as rootDebounced } from '../src/index.ts';

describe('SV2-015 shared debounce implementation', () => {
  it('exposes one function through both core entry points and signals', () => {
    expect(coreDebounced).toBe(signalsDebounced);
    expect(csrDebounced).toBe(signalsDebounced);
    expect(rootDebounced).toBe(signalsDebounced);
  });

  it('preserves synchronous initial reads and idempotent cleanup', () => {
    const source = state('initial');
    const value: DebouncedAccessor<string> = coreDebounced(source, 10);
    expect(value()).toBe('initial');
    expect(value.get()).toBe('initial');
    expect(value.peek()).toBe('initial');
    value.dispose();
    value.dispose();
    expect(value()).toBe('initial');
  });

  it('preserves validation of invalid debounce delays', () => {
    expect(() => coreDebounced(() => 1, -1)).toThrow(RangeError);
    expect(() => coreDebounced(() => 1, Infinity)).toThrow(RangeError);
    expect(() => coreDebounced(() => 1, NaN)).toThrow(RangeError);
  });
});
