import { mount } from 'svelte';
import TickerApp from './TickerApp.svelte';

mount(TickerApp, { target: document.getElementById('app')! });
