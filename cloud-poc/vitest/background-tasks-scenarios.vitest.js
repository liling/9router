import { describe, expect, it } from 'vitest';
import { composeCloudflareBackgroundRuntime, createCloudflareBackgroundTasks } from '../../open-sse/runtime/adapters/cloudflareBackgroundTasks.js';
import { backgroundTasksScenarios } from '../../tests/unit/runtime/background-tasks.scenario.js';

describe('Cloudflare BackgroundTasks scenarios', () => {
  backgroundTasksScenarios((options) => {
    const owned = [];
    const tasks = createCloudflareBackgroundTasks({
      ...options,
      executionContext: { waitUntil: (promise) => owned.push(promise) },
    });
    return { ...tasks, close: async () => { await tasks.close(); await Promise.all(owned); } };
  });

  it('composes only BackgroundTasks and keeps Scheduler unavailable', () => {
    const runtime = composeCloudflareBackgroundRuntime({
      executionContext: { waitUntil() {} },
      httpTransport: { fetch() {} },
    });
    expect(runtime.assertPort('backgroundTasks')).toBe(runtime.backgroundTasks);
    expect(runtime.descriptor.ports.backgroundTasks).toMatchObject({ available: true });
    expect(runtime.descriptor.ports.backgroundTasks.planned).toBeUndefined();
    expect(runtime.descriptor.ports.scheduler).toMatchObject({ available: false, planned: { adapter: 'Cron Triggers' } });
    expect(() => runtime.assertPort('scheduler')).toThrow();
  });

  it('reports synchronous waitUntil registration failure as a drop', async () => {
    const dropped = [];
    const tasks = createCloudflareBackgroundTasks({
      executionContext: { waitUntil() { throw new Error('registration rejected'); } },
      onDrop: (task) => dropped.push(task.id),
    });
    tasks.enqueue({ id: 'rejected-registration', execute: async () => { throw new Error('must not run'); } });
    await tasks.close();
    expect(dropped).toEqual(['rejected-registration']);
  });
});
