import { mount } from '@purityjs/core';
import { controlsView } from './controls-view.ts';

mount(controlsView(), document.getElementById('app')!);
