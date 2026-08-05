import { ChildProcess } from 'child_process';

export class MediaProcessTimeoutError extends Error {}
export class MediaProcessStartError extends Error {}

const describeCeiling = (timeoutMs: number): string =>
  timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;

/**
 * Close the two settlement paths a bare `spawn` leaves open: a process that
 * fails to start emits `'error'` and never `'close'`, and a wedged process
 * emits neither, so a promise settled only from `'close'` never settles and
 * the awaiting job hangs forever.
 *
 * Call sites keep their own `spawn` argument arrays and stream handling; this
 * only attaches the missing listeners. Settling twice is a no-op, so a kill
 * that is followed by a `'close'` still reports the timeout as the cause.
 */
export const guardMediaProcess = (
  child: ChildProcess,
  options: { label: string; timeoutMs: number },
  reject: (error: Error) => void,
): void => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new MediaProcessTimeoutError(
      `${options.label} exceeded its ${describeCeiling(options.timeoutMs)} limit and was terminated`,
    ));
  }, options.timeoutMs);
  // Never let a pending ceiling be the only thing keeping the process alive.
  timer.unref();

  child.once('error', (error: Error) => {
    clearTimeout(timer);
    reject(new MediaProcessStartError(`${options.label} could not be run: ${error.message}`));
  });

  child.once('close', () => {
    clearTimeout(timer);
  });
};
