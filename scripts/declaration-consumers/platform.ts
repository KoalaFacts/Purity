// Consumer of the built `@purityjs/platform` declarations (SV2-014).
import { type ServerAction, serverAction } from '@purityjs/platform/actions';

const save = serverAction('/api/save', async (request: Request) => {
  const body: string = await request.text();
  return new Response(body, { status: 201 });
});
const action: ServerAction = save;
const url: string = save.url;
const pending: Promise<Response> = save.invoke(JSON.stringify({ ok: true }), { method: 'POST' });

// @ts-expect-error handlers must return a Response
serverAction('/api/bad', async () => ({ status: 200, body: 'oops' }));
// @ts-expect-error handlers must return a Response, not undefined
serverAction('/api/none', async () => undefined);
// @ts-expect-error the URL is a string
serverAction(42, async () => new Response());
// @ts-expect-error invoke() bodies are BodyInit
save.invoke({ ok: true });

void [action, url, pending];
