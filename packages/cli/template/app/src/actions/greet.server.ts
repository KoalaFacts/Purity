import { serverAction } from '@purityjs/core';
import { greetingActionUrl } from './greet.ts';

export const greet = serverAction(greetingActionUrl, async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const type = request.headers.get('content-type')?.split(';')[0].trim();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') {
    return new Response('Submit form data', { status: 415 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Invalid form data', { status: 400 });
  }
  const input = form.get('name');
  const name = typeof input === 'string' ? input.trim() : '';
  const valid = name.length > 0 && name.length <= 80;
  const error = 'Enter a name between 1 and 80 characters.';
  if (request.headers.get('accept')?.includes('application/json')) {
    return Response.json(
      valid ? { message: `Hello, ${name}!` } : { message: error, fieldErrors: { name: error } },
      {
        status: valid ? 200 : 422,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
  const location = new URL('/greeting', request.url);
  location.searchParams.set('name', name.slice(0, 80));
  location.searchParams.set(valid ? 'submitted' : 'error', '1');
  return new Response(null, {
    status: 303,
    headers: { Location: location.href, 'Cache-Control': 'no-store' },
  });
});
