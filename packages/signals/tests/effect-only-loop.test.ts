import { expect, it, vi } from 'vite-plus/test';

it('recovers from a feedback loop before any computed has been created', async () => {
  vi.resetModules();
  const { state, watchEffectInternal } = await import('../src/index.ts');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const a = state(0);
    const b = state(0);
    let looping = true;
    let seen = 0;
    const stopA = watchEffectInternal(() => {
      seen = a();
      if (looping) b(seen + 1);
      return undefined;
    });
    const stopB = watchEffectInternal(() => {
      const value = b();
      if (looping) a(value + 1);
      return undefined;
    });
    await Promise.resolve();
    expect(error.mock.calls.some(([message]) => String(message).includes('feedback loop'))).toBe(
      true,
    );
    looping = false;
    a(42);
    await Promise.resolve();
    expect(seen).toBe(42);
    stopA();
    stopB();
  } finally {
    error.mockRestore();
  }
});
