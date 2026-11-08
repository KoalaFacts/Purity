// Consumer of the built `@purityjs/ssr` declarations (SV2-014 slice 2).
import {
  type RenderToStringWithHead,
  type RenderToStringWithResponse,
  html,
  renderToStream,
  renderToString,
} from '@purityjs/ssr';

import { type Equal, expectType } from './expect';

const app = () => html`<p>${'hi'}</p>`;

// renderToString() overloads narrow on the extraction flags.
const plain = renderToString(app, { timeout: 1000, nonce: 'n' });
const withHead = renderToString(app, { extractHead: true });
const withResponse = renderToString(app, { extractResponse: true });
expectType<Equal<typeof plain, Promise<string>>>();
expectType<Equal<typeof withHead, Promise<RenderToStringWithHead>>>();
expectType<Equal<typeof withResponse, Promise<RenderToStringWithResponse>>>();
// @ts-expect-error extractHead results are not plain strings
expectType<Equal<typeof withHead, Promise<string>>>();
// @ts-expect-error timeout is a number of milliseconds
renderToString(app, { timeout: '1s' });
// @ts-expect-error unknown options are rejected
renderToString(app, { streaming: true });
// @ts-expect-error the view is a function, not a template result
renderToString(app());

const stream = renderToStream(app, { signal: new AbortController().signal });
expectType<Equal<typeof stream, ReadableStream<Uint8Array>>>();
// @ts-expect-error signal must be an AbortSignal
renderToStream(app, { signal: true });
