import type { RouteParams } from '@purityjs/vite-plugin';

export function loader(params: RouteParams<'/users/:id'>): { id: string; name: string } {
  return { id: params.id, name: 'Ada' };
}

export default function User(): Node {
  return document.createElement('article');
}
