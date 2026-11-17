// Exact type equality for declaration consumers (SV2-014): fails unless A and
// B are identical, so a widened (`any`) or swapped return type is caught.
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export declare function expectType<T extends true>(): void;
