// Shared component used by both entry.server.ts and entry.client.ts.
//
// Uses @purityjs/core's `html` import — the Vite plugin AOT-compiles each
// `html\`\`` call site for the appropriate build target (DOM-builder for the
// client bundle, string-builder for the SSR bundle).
import { component, eachSSR, html, resource, state } from '@purityjs/core';

// A registered component. SSR renders this with `<template shadowrootmode>`
// (Declarative Shadow DOM); the client constructor reuses the parser-attached
// shadow root and re-renders against it.
component<{ count: number }>('demo-counter', ({ count }) => {
  return html`
    <div>
      <h2>Count: ${() => count}</h2>
      <p>Server-rendered, hydrated on the client.</p>
    </div>
  `;
});

export function App() {
  // Async resource — server awaits before serializing, payload is embedded
  // for the client to skip the first refetch.
  const todos = resource(async () => {
    // Simulate latency. In a real app this would be a `fetch(...)` call.
    await new Promise((r) => setTimeout(r, 30));
    return ['Write tests', 'Ship SSR', 'Celebrate'];
  });

  const greeting = state('hello, world');

  return html`
    <main>
      <h1>${() => greeting()}</h1>
      <demo-counter :count=${42}></demo-counter>
      <ul>
        ${eachSSR(
          () => todos() ?? [],
          (item) => html`<li>${() => item()}</li>`,
        )}
      </ul>
    </main>
  `;
}
