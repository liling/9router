import { assertScheduler } from '../ports/scheduler.js';

export function createLocalIntervalScheduler({ backgroundTasks, onError = () => {} }) {
  const intervals = new Map();
  let closed = false;
  let tick = 0;

  const port = {
    schedule({ id, intervalMs, handlerId, execute }) {
      if (closed) throw new Error('Scheduler is closed');
      if (!id || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new TypeError('A schedule requires an id and positive intervalMs');
      }
      if (typeof execute !== 'function' && typeof handlerId !== 'string') {
        throw new TypeError('A schedule requires execute or handlerId');
      }
      clearInterval(intervals.get(id));
      const interval = setInterval(() => {
        try {
          backgroundTasks.enqueue({ id: `${id}:${++tick}`, execute: execute ?? (() => { throw new Error(`No handler registered: ${handlerId}`); }) });
        } catch (error) {
          onError(error, { id, handlerId });
        }
      }, intervalMs);
      intervals.set(id, interval);
    },
    close() {
      closed = true;
      for (const interval of intervals.values()) clearInterval(interval);
      intervals.clear();
    },
  };

  return assertScheduler(port);
}
