import { assertScheduler, validateScheduleSpec } from '../ports/scheduler.js';

export function createLocalIntervalScheduler({ backgroundTasks, onError = () => {} }) {
  const intervals = new Map();
  let closed = false;
  let tick = 0;

  const port = {
    schedule(scheduleSpec) {
      validateScheduleSpec(scheduleSpec);
      if (closed) throw new Error('Scheduler is closed');
      const { id, trigger: { intervalMs }, handlerId, execute } = scheduleSpec;
      clearInterval(intervals.get(id));
      const interval = setInterval(() => {
        try {
          backgroundTasks.enqueue({ id: `${id}:${++tick}`, execute });
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
