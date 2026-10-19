import { describe, expect, it, vi } from 'vitest';
import { createLocalBackgroundTasks } from '../../../open-sse/runtime/adapters/localBackgroundTasks.js';
import { createLocalIntervalScheduler } from '../../../open-sse/runtime/adapters/localIntervalScheduler.js';
import { backgroundTasksScenarios } from './background-tasks.scenario.js';

describe('Local BackgroundTasks scenarios', () => {
  backgroundTasksScenarios(createLocalBackgroundTasks);
});

describe('Local interval Scheduler', () => {
  it('re-registers an id by replacing its interval and routes ticks through BackgroundTasks', async () => {
    vi.useFakeTimers();
    const backgroundTasks = createLocalBackgroundTasks();
    const first = vi.fn();
    const second = vi.fn();
    const scheduler = createLocalIntervalScheduler({ backgroundTasks });
    scheduler.schedule({ id: 'refresh', intervalMs: 20, execute: first });
    scheduler.schedule({ id: 'refresh', intervalMs: 10, execute: second });
    await vi.advanceTimersByTimeAsync(10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    scheduler.close();
    await backgroundTasks.close();
    vi.useRealTimers();
  });
});
