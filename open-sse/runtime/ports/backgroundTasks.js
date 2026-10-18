export const BACKGROUND_TASK_METHODS = Object.freeze(['enqueue', 'schedule']);

export function assertBackgroundTasks(port) {
  for (const method of BACKGROUND_TASK_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`BackgroundTasks.${method} is required`);
  }
  return port;
}
