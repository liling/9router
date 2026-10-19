import { assertBackgroundTasks } from '../ports/backgroundTasks.js';

export function createLocalBackgroundTasks({ onError = () => {}, onDrop = () => {} } = {}) {
  const pending = new Set();
  let closed = false;

  const report = (callback, ...args) => {
    try { callback(...args); } catch { /* Observability must not affect task submission. */ }
  };

  const port = {
    enqueue(task) {
      if (closed) {
        report(onDrop, task);
        return;
      }
      const record = { started: false, task };
      pending.add(record);
      Promise.resolve().then(() => {
        if (closed && !record.started) {
          pending.delete(record);
          report(onDrop, task);
          return;
        }
        record.started = true;
        return task.execute();
      }).catch((error) => report(onError, error, task))
        .then(() => pending.delete(record));
    },
    async close({ drain = true } = {}) {
      closed = true;
      if (!drain) {
        for (const record of pending) {
          if (!record.started) {
            pending.delete(record);
            report(onDrop, record.task);
          }
        }
        return;
      }
      while (pending.size) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };

  return assertBackgroundTasks(port);
}
