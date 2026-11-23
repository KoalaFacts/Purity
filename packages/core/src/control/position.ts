import { type ItemSignal, itemSignalInternal } from '@purityjs/signals';

/** Current-position accessor for an each() row (SV2-008); the signal is created on first read. */
export function rowPosition(
  entry: { i?: number; p?: ItemSignal<number> },
  index: number,
): () => number {
  entry.i = index;
  return () => (entry.p ??= itemSignalInternal(entry.i!))();
}
