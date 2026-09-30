import { html, routeData, type LoaderContext } from '@purityjs/core';
import { greetingActionUrl } from '../actions/greet.ts';

type GreetingData = { name: string; error: boolean; submitted: boolean };

export function loader({ request }: LoaderContext) {
  const params = new URL(request.url).searchParams;
  const error = params.get('error') === '1';
  return routeData(
    {
      name: (params.get('name') ?? '').slice(0, 80),
      error,
      submitted: params.get('submitted') === '1',
    },
    { status: error ? 422 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export default function Greeting(_params: Record<string, string>, data: GreetingData): unknown {
  return html`<main>
    <h1>Send a greeting</h1>
    <p>This form works with or without JavaScript. It does not store your name.</p>
    ${data.submitted ? html`<p role="status">Hello, ${data.name}!</p>` : null}
    <form action=${greetingActionUrl} method="POST">
      <label for="name">Your name</label>
      <input
        id="name"
        name="name"
        value=${data.name}
        required
        maxlength="80"
        aria-invalid=${data.error ? 'true' : 'false'}
        aria-describedby=${data.error ? 'name-help name-error' : 'name-help'}
      />
      <p id="name-help">Use 1 to 80 characters.</p>
      ${
        data.error
          ? html`<p id="name-error" role="alert">Enter a name between 1 and 80 characters.</p>`
          : null
      }
      <button type="submit">Send greeting</button>
    </form>
    <a href="/">Home</a>
  </main>`;
}
