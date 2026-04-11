export const SIZES = [10, 100, 1_000, 10_000] as const;
export type Size = (typeof SIZES)[number];

export function sizeLabel(n: number): string {
  if (n >= 10_000) return "10k";
  if (n >= 1_000) return "1k";
  return String(n);
}

export function sizeId(prefix: string, n: number): string {
  return `${prefix}-${sizeLabel(n)}`;
}
