import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { inject, provide } from '../src/inject.ts';
import { state } from '../src/signals.ts';

describe('provide/inject', () => {
  it('provides and injects a value', () => {
    let injected;

    function Parent() {
      provide('theme', 'dark');
      return html`<div>${Child()}</div>`;
    }

    function Child() {
      injected = inject('theme');
      return html`<span>child</span>`;
    }

    const container = document.createElement('div');
    mount(Parent, container);

    expect(injected).toBe('dark');
  });

  it('provides reactive state', () => {
    let injected;

    function Parent() {
      const theme = state('dark');
      provide('theme', theme);
      return html`<div>${Child()}</div>`;
    }

    function Child() {
      injected = inject('theme');
      return html`<span>child</span>`;
    }

    const container = document.createElement('div');
    mount(Parent, container);

    expect(injected()).toBe('dark');
    injected('light');
    expect(injected()).toBe('light');
  });

  it('injects from ancestor (not just parent)', () => {
    let injected;

    function Root() {
      provide('api', 'https://api.example.com');
      return html`<div>${Middle()}</div>`;
    }

    function Middle() {
      return html`<div>${Leaf()}</div>`;
    }

    function Leaf() {
      injected = inject('api');
      return html`<span>leaf</span>`;
    }

    const container = document.createElement('div');
    mount(Root, container);

    expect(injected).toBe('https://api.example.com');
  });

  it('uses fallback when key not provided', () => {
    let injected;

    function App() {
      injected = inject('missing', 'default-value');
      return html`<span>app</span>`;
    }

    const container = document.createElement('div');
    mount(App, container);

    expect(injected).toBe('default-value');
  });

  it('throws when key not provided and no fallback', () => {
    function App() {
      inject('missing');
      return html`<span>app</span>`;
    }

    const container = document.createElement('div');
    expect(() => mount(App, container)).toThrow('not found');
  });

  it('supports symbol keys', () => {
    const THEME = Symbol('theme');
    let injected;

    function Parent() {
      provide(THEME, 'dark');
      return html`<div>${Child()}</div>`;
    }

    function Child() {
      injected = inject(THEME);
      return html`<span>child</span>`;
    }

    const container = document.createElement('div');
    mount(Parent, container);

    expect(injected).toBe('dark');
  });
});
