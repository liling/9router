export const BACKGROUND_TASK_METHODS = Object.freeze(['enqueue']);

/**
 * enqueue(task: { id: string; execute: () => Promise<unknown>; note?: string }): void
 * is fire-and-forget: callers must not await it and adapters may drop work under
 * platform pressure. execute must never perform authoritative state transitions.
 * Cloud credential refresh remains lazy-on-read.
 */
export function assertBackgroundTasks(port) {
  for (const method of BACKGROUND_TASK_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`BackgroundTasks.${method} is required`);
  }
  return port;
}
