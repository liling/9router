import { describe, expect, it } from 'vitest';
import { validateScheduleSpec } from '../../../open-sse/runtime/ports/scheduler.js';

describe('Scheduler schedule contract', () => {
  it('accepts canonical Local interval and config-declared cron triggers', () => {
    const intervalSpec = {
      id: 'catalog-refresh',
      trigger: { kind: 'interval', intervalMs: 60_000 },
      handlerId: 'model-catalog-sync',
      execute: async () => {},
    };
    const cronSpec = {
      id: 'nightly-refresh',
      trigger: { kind: 'cron', cron: '0 3 * * *' },
      handlerId: 'nightly-sync',
    };

    expect(validateScheduleSpec(intervalSpec)).toBe(intervalSpec);
    expect(validateScheduleSpec(cronSpec)).toBe(cronSpec);
  });

  it.each([
    ['non-object spec', null],
    ['missing id', { trigger: { kind: 'cron', cron: '0 3 * * *' }, handlerId: 'sync' }],
    ['missing trigger', { id: 'sync', handlerId: 'sync' }],
    ['unknown trigger kind', { id: 'sync', trigger: { kind: 'timer' }, handlerId: 'sync' }],
    ['legacy top-level cron', { id: 'sync', cron: '0 3 * * *', handlerId: 'sync' }],
    ['legacy top-level interval', { id: 'sync', intervalMs: 1000, handlerId: 'sync' }],
    ['non-positive interval', { id: 'sync', trigger: { kind: 'interval', intervalMs: 0 }, handlerId: 'sync', execute() {} }],
    ['non-finite interval', { id: 'sync', trigger: { kind: 'interval', intervalMs: Infinity }, handlerId: 'sync', execute() {} }],
    ['cron without string expression', { id: 'sync', trigger: { kind: 'cron', cron: 123 }, handlerId: 'sync' }],
    ['missing handler id', { id: 'sync', trigger: { kind: 'cron', cron: '0 3 * * *' } }],
    ['interval without in-process handler', { id: 'sync', trigger: { kind: 'interval', intervalMs: 1000 }, handlerId: 'sync' }],
    ['cron with in-process handler', { id: 'sync', trigger: { kind: 'cron', cron: '0 3 * * *' }, handlerId: 'sync', execute() {} }],
  ])('rejects %s synchronously', (_description, spec) => {
    expect(() => validateScheduleSpec(spec)).toThrow(TypeError);
  });
});
