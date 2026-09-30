// Run against built packages with --expose-gc. Keep the response open while
// checking that completed boundaries no longer retain their captured payloads.
import assert from 'node:assert/strict';
import { setImmediate as nextJob } from 'node:timers/promises';
import { resource, suspense } from '@purityjs/core';
import { html, renderToStream, renderToStreamResponse } from '@purityjs/ssr';

const collect = globalThis.gc;
assert.ok(collect, 'Run this check with --expose-gc');
const payloadBytes = 1024 * 1024;
const boundaryCount = 32;

function completedBoundary(refs: WeakRef<Uint8Array>[], index: number) {
  const payload = new Uint8Array(payloadBytes);
  payload.fill(index);
  refs.push(new WeakRef(payload));
  return suspense(
    () => html`<p>${payload[0]}:${payload.byteLength}</p>`,
    () => html`<p>WAITING</p>`,
  );
}

const renderers = [
  {
    name: 'direct stream',
    render: async (view: () => unknown) => renderToStream(view, { timeout: 60_000 }),
  },
  {
    name: 'prepared stream',
    render: async (view: () => unknown) =>
      (await renderToStreamResponse(view, { timeout: 60_000 })).body,
  },
];

for (const { name, render } of renderers) {
  const refs: WeakRef<Uint8Array>[] = [];
  let started!: () => void;
  const pendingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let activeSignal!: AbortSignal;
  const stream = await render(
    () =>
      html`<main>${Array.from({ length: boundaryCount }, (_, index) => completedBoundary(refs, index))}${suspense(
        () => {
          const data = resource(({ signal }) => {
            activeSignal = signal;
            started();
            return new Promise<string>(() => {});
          });
          return html`<p>${() => data()}</p>`;
        },
        () => html`<p>STILL-WAITING</p>`,
      )}</main>`,
  );
  const reader = stream.getReader();
  try {
    await reader.read(); // Shell, including the swap helper.
    for (let id = 1; id <= boundaryCount; id++) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      assert.ok(new TextDecoder().decode(value).includes(`__purity_swap(${id});`));
    }
    await pendingStarted;
    assert.equal(refs.length, boundaryCount);
    let retained = boundaryCount;
    // A dereference keeps its target alive until the current job ends.
    // Yield before every collection, and never save dereferenced payloads.
    for (let attempt = 0; attempt < 20 && retained > 0; attempt++) {
      await nextJob();
      collect();
      await nextJob();
      retained = refs.filter((ref) => ref.deref() !== undefined).length;
    }
    assert.equal(activeSignal.aborted, false, 'The final boundary must still be active');
    console.log(
      `${name}: ${retained}/${boundaryCount} completed payloads retained (${retained * payloadBytes} bytes) while the response remains open`,
    );
    assert.equal(retained, 0, 'Completed boundary callbacks must release their captured payloads');
  } finally {
    await reader.cancel(new Error('retention check complete'));
    reader.releaseLock();
  }
  assert.equal(activeSignal.aborted, true, 'Cancel must stop the final boundary');
}
