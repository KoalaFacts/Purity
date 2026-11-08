// Consumer of the built `@purityjs/signals` declarations (SV2-014).
// Every `@ts-expect-error` is a negative contract: tsc fails with TS2578 if
// the published types stop rejecting the line.
import {
  type ComputedAccessor,
  type Dispose,
  type StateAccessor,
  batch,
  compute,
  state,
  watch,
} from '@purityjs/signals';

const count: StateAccessor<number> = state(0);
const label: ComputedAccessor<string> = compute(() => `n=${count()}`);

count(1);
count((n) => n + 1);
count.set(2);
const read: number = count.peek();
const text: string = label();

// @ts-expect-error a number state does not accept a string
count('one');
// @ts-expect-error updater must return the state type
count((n) => `${n}`);
// @ts-expect-error computed accessors are read-only
label('x');
// @ts-expect-error computed accessors have no set()
label.set('x');

// watch() overloads: effect, single source, tuple of sources.
const stopEffect: Dispose = watch(() => {
  count();
});
const stopOne: Dispose = watch(count, (value, old) => {
  const sum: number = value + old;
  void sum;
});
const stopMany: Dispose = watch([count, label, () => true], ([n, s, b], [oldN]) => {
  const tuple: [number, string, boolean] = [n, s, b];
  const previous: number = oldN;
  void tuple;
  void previous;
});
watch(count, (value) => {
  // @ts-expect-error single-source callbacks receive the source type
  const wrong: string = value;
  void wrong;
});
watch([count, label], ([n, s]) => {
  // @ts-expect-error tuple sources keep their element types in order
  const swapped: [string, number] = [n, s];
  void swapped;
});
// @ts-expect-error a source needs a callback that takes its value
watch(count, (value: string) => value);

batch(() => {
  count(3);
});
// @ts-expect-error batch takes a function
batch(1);

stopEffect();
stopOne();
stopMany();
void read;
void text;
