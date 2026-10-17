function describeKey(key: unknown): string {
  // String(key) throws for null-prototype objects; a diagnostic must not abort
  // the render, so report the conversion error and fall back to the type name.
  try {
    return JSON.stringify(String(key));
  } catch (e) {
    console.error('[Purity] key format:', e);
    return `<${typeof key}>`;
  }
}

export function warnDuplicateKey(key: unknown, index: number, api = 'each()'): void {
  console.warn(
    `[Purity] ${api} duplicate key ${describeKey(key)} at index ${index}; only the first row renders. keyFn must be unique.`,
  );
}
