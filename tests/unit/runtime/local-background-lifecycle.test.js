import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalBackgroundTasks } from '../../../open-sse/runtime/adapters/localBackgroundTasks.js';
import { createLocalIntervalScheduler } from '../../../open-sse/runtime/adapters/localIntervalScheduler.js';
import { validateScheduleSpec } from '../../../open-sse/runtime/ports/scheduler.js';
import { backgroundTasksScenarios } from './background-tasks.scenario.js';

describe('Local BackgroundTasks scenarios', () => {
  backgroundTasksScenarios(createLocalBackgroundTasks);
});

describe('Local interval Scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('re-registers an id by replacing its interval and routes ticks through BackgroundTasks', async () => {
    vi.useFakeTimers();
    const backgroundTasks = createLocalBackgroundTasks();
    const first = vi.fn();
    const second = vi.fn();
    const scheduler = createLocalIntervalScheduler({ backgroundTasks });
    scheduler.schedule({ id: 'refresh', trigger: { kind: 'interval', intervalMs: 20 }, handlerId: 'refresh', execute: first });
    scheduler.schedule({ id: 'refresh', trigger: { kind: 'interval', intervalMs: 10 }, handlerId: 'refresh', execute: second });
    await vi.advanceTimersByTimeAsync(10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    scheduler.close();
    await backgroundTasks.close();
  });

  it('rejects legacy schedule shapes and shares validator errors at registration', () => {
    const scheduler = createLocalIntervalScheduler({ backgroundTasks: createLocalBackgroundTasks() });
    const legacySpec = { id: 'legacy', intervalMs: 10, handlerId: 'refresh', execute: vi.fn() };
    expect(() => scheduler.schedule(legacySpec)).toThrow(TypeError);

    const invalidSpec = {
      id: 'missing-execute',
      trigger: { kind: 'interval', intervalMs: 10 },
      handlerId: 'refresh',
    };
    let validationError;
    try {
      validateScheduleSpec(invalidSpec);
    } catch (error) {
      validationError = error;
    }
    expect(validationError).toBeInstanceOf(TypeError);
    expect(() => scheduler.schedule(invalidSpec)).toThrow(validationError.message);
    scheduler.close();
  });
});
