import { cancelSSRBoundary, nextSSRBoundaryDeadline, type SSRRenderContext } from '@purityjs/core';

// Resource settlement can remove the boundary that initially owned the timer.
// Recheck at wakeup so a completed neighbor never surrenders to its fallback.
export function boundaryDeadline(
  ctx: SSRRenderContext,
  maximum: number,
  expire: (id?: number) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const nearest = nextSSRBoundaryDeadline(ctx);
    timer = setTimeout(
      () => {
        const now = Date.now();
        if (now >= maximum) {
          expire();
          return;
        }
        const active = nextSSRBoundaryDeadline(ctx);
        if (active && active.deadline <= now) {
          cancelSSRBoundary(
            ctx,
            active.id,
            new DOMException('Suspense boundary timed out', 'TimeoutError'),
          );
          expire(active.id);
          return;
        }
        schedule();
      },
      Math.max(0, Math.min(maximum, nearest?.deadline ?? Infinity) - Date.now()),
    );
  };
  schedule();
  return () => clearTimeout(timer);
}
