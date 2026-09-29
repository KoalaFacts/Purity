// Build-time only. This module is never imported by the browser entry.
export const staticPaths: Record<
  string,
  (() => readonly string[] | Promise<readonly string[]>) | undefined
> = {
  '/posts/:slug': () => ['/posts/hello'],
};
