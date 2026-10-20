export const SCHEDULER_METHODS = Object.freeze(['schedule']);

/**
 * schedule({
 *   id: string,
 *   trigger: { kind: 'interval', intervalMs: number } | { kind: 'cron', cron: string },
 *   handlerId: string,
 *   execute?: () => void | Promise<void>,
 * }): void
 * Config-declared platforms (Cloudflare Cron Triggers and Vercel Cron) must
 * validate that id is declared and a cron trigger matches platform config.
 * Local interval triggers require execute as the in-process binding for handlerId;
 * re-registering an id replaces its interval. Cron triggers omit execute because
 * the platform resolves handlerId. Local replacement is not a promise that
 * config-declared schedules are mutable. This contract does not promise
 * cancellation, listing, execution, or completion.
 */
export function validateScheduleSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('A schedule must be an object');
  }
  if (Object.hasOwn(spec, 'cron') || Object.hasOwn(spec, 'intervalMs')) {
    throw new TypeError('Schedule cadence must be declared under trigger');
  }
  if (typeof spec.id !== 'string' || !spec.id) {
    throw new TypeError('A schedule requires an id');
  }
  if (typeof spec.handlerId !== 'string' || !spec.handlerId) {
    throw new TypeError('A schedule requires a handlerId');
  }
  if (!spec.trigger || typeof spec.trigger !== 'object' || Array.isArray(spec.trigger)) {
    throw new TypeError('A schedule requires a trigger');
  }

  if (spec.trigger.kind === 'interval') {
    if (!Number.isFinite(spec.trigger.intervalMs) || spec.trigger.intervalMs <= 0) {
      throw new TypeError('An interval trigger requires a positive finite intervalMs');
    }
    if (typeof spec.execute !== 'function') {
      throw new TypeError('An interval trigger requires execute for its handlerId');
    }
    return spec;
  }

  if (spec.trigger.kind === 'cron') {
    if (typeof spec.trigger.cron !== 'string' || !spec.trigger.cron) {
      throw new TypeError('A cron trigger requires a cron string');
    }
    if (Object.hasOwn(spec, 'execute')) {
      throw new TypeError('A cron trigger must not provide execute');
    }
    return spec;
  }

  throw new TypeError('A schedule trigger kind must be interval or cron');
}

export function assertScheduler(port) {
  for (const method of SCHEDULER_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`Scheduler.${method} is required`);
  }
  return port;
}
