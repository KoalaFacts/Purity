import { getCurrentComponent } from '@purityjs/signals';
import { addComponentCallback } from '../component.ts';
import { component, type ComponentOptions, type RenderFn } from '../elements.ts';
import { enableFormLifecycle } from './lifecycle-setup.ts';
export { enableFormLifecycle } from './lifecycle-setup.ts';

/** Define a form-associated element that does not bridge a native control. */
export function formComponent<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(
  tagName: string,
  renderFn: RenderFn<P, S>,
  options?: ComponentOptions,
): (props: P, children?: any) => Node | DocumentFragment {
  enableFormLifecycle();
  return component(tagName, renderFn, { formAssociated: true, ...options });
}

export function onFormAssociated(fn: (form: HTMLFormElement | null) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formAssociated ??= []), fn);
}
export function onFormDisabled(fn: (disabled: boolean) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formDisabled ??= []), fn);
}
export function onFormReset(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formReset ??= []), fn);
}
export function onFormStateRestore(
  fn: (state: string | File | FormData | null, mode: 'restore' | 'autocomplete') => void,
): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formStateRestore ??= []), fn);
}
