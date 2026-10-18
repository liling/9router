export const SCHEDULER_METHODS = Object.freeze(['schedule']);

/**
 * schedule(schedule: { id: string; cron: string; handlerId: string }): void
 * Config-declared platforms (Cloudflare Cron Triggers and Vercel Cron) must
 * validate that id is declared and cron matches; an undeclared or mismatched
 * schedule throws RuntimeCapabilityError('RUNTIME_CAPABILITY_UNAVAILABLE').
 * Local runtimes dynamically register schedules with setInterval. This contract
 * does not promise cancellation or listing.
 */
export function assertScheduler(port) {
  for (const method of SCHEDULER_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`Scheduler.${method} is required`);
  }
  return port;
}
