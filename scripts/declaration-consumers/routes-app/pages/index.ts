import { routeData } from '@purityjs/router';

// A loader that wraps its value with `routeData()` (status + headers).
export async function loader() {
  return routeData({ posts: [1, 2, 3] }, { status: 200 });
}

export default function Home(): Node {
  return document.createElement('main');
}
