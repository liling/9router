export const BACKGROUND_TASK_METHODS = Object.freeze(['enqueue']);

/**
 * enqueue(task: { id: string; execute: () => Promise<unknown>; note?: string }): void
 * is best-effort. Returning means only that submission was attempted, never
 * that work was accepted or completed. Adapters may drop work and must observe
 * and report handler failures without rejecting the caller or creating an
 * unhandled rejection. Work must not perform authoritative state transitions.
 * Cloud credential refresh remains lazy-on-read.
 */
export function assertBackgroundTasks(port) {
  for (const method of BACKGROUND_TASK_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`BackgroundTasks.${method} is required`);
  }
  return port;
}
