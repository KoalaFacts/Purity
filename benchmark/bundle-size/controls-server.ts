import { renderToString } from '@purityjs/ssr';
import { controlsView } from './controls-view.ts';

export function render() {
  return renderToString(controlsView());
}
