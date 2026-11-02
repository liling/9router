import { expect, it } from 'vitest';

export function backgroundTasksScenarios(createAdapter) {
  it('runs submitted work asynchronously and isolates task failure from the caller', async () => {
    const errors = [];
    const tasks = createAdapter({ onError: (...details) => errors.push(details) });
    let completed = false;
    tasks.enqueue({ id: 'scenario-success', execute: async () => { completed = true; } });
    tasks.enqueue({ id: 'scenario-failure', execute: async () => { throw new Error('expected'); } });
    expect(completed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(true);
    expect(errors).toHaveLength(1);
    await tasks.close();
  });

  it('reports new submissions as dropped after shutdown', async () => {
    const dropped = [];
    const tasks = createAdapter({ onDrop: (task) => dropped.push(task.id) });
    await tasks.close();
    expect(tasks.enqueue({ id: 'after-close', execute: async () => {} })).toBeUndefined();
    expect(dropped).toEqual(['after-close']);
  });
}
