import { hydrate, mount } from '@purityjs/core';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) {
  const component = App as () => Node | DocumentFragment;
  if (root.hasChildNodes()) hydrate(root, component);
  else mount(component, root);
}
