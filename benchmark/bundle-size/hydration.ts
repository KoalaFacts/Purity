import { hydrate } from '@purityjs/core';
import { controlsView } from './controls-view.ts';

hydrate(document.getElementById('app')!, controlsView());
document.getElementById('app')!.dataset.hydrated = 'true';
