import type { SSRRenderContext } from '@purityjs/core/ssr-bridge';

// One session per string render, stream shell or streamed boundary. Only the
// boundary marker namespace is shared between a shell and its boundaries.
type RenderSession = Required<
  Pick<
    SSRRenderContext,
    | 'resolvedData'
    | 'resolvedErrors'
    | 'resolvedDataByKey'
    | 'resolvedErrorsByKey'
    | 'boundaryStartTimes'
    | 'boundaryDeadlines'
    | 'timedOutBoundaries'
    | 'boundaryAborts'
    | 'pendingResources'
    | 'boundaryIds'
  >
>;

export function createRenderSession(boundaryIds = new Map<string, number>()): RenderSession {
  return {
    resolvedData: [],
    resolvedErrors: [],
    // Resource keys such as __proto__ must remain ordinary cache keys.
    resolvedDataByKey: Object.create(null),
    resolvedErrorsByKey: Object.create(null),
    boundaryStartTimes: new Map(),
    boundaryDeadlines: new Map(),
    timedOutBoundaries: new Set(),
    boundaryAborts: new Map(),
    pendingResources: new Map(),
    boundaryIds,
  };
}

// Fresh counters and pending work per pass; cached values/deadlines survive
// retries. Mode-specific fields stay with the caller, including their absence.
export function createRenderContext(
  session: RenderSession,
  request: Request | undefined,
  signal: AbortSignal | undefined,
): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: session.resolvedData,
    resolvedErrors: session.resolvedErrors,
    resolvedDataByKey: session.resolvedDataByKey,
    resolvedErrorsByKey: session.resolvedErrorsByKey,
    resourceCounter: 0,
    suspenseCounter: 0,
    islandCounter: 0,
    boundaryStartTimes: session.boundaryStartTimes,
    boundaryDeadlines: session.boundaryDeadlines,
    timedOutBoundaries: session.timedOutBoundaries,
    pendingResources: session.pendingResources,
    boundaryIds: session.boundaryIds,
    request,
    signal,
  };
}
