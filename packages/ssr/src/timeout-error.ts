/** A renderer's wait budget expired before its output was ready. */
export class SSRTimeoutError extends Error {
  readonly code = 'PURITY_SSR_TIMEOUT';

  constructor(
    readonly phase: 'render' | 'shell',
    readonly timeout: number,
    message: string = `[Purity] ${phase === 'render' ? 'renderToString' : 'renderToStream shell'} timed out after ${timeout}ms.`,
  ) {
    super(message);
    this.name = 'SSRTimeoutError';
  }
}
