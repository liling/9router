import { defineRuntimeDescriptor } from '../descriptor.js';
import { composeRuntime } from '../context.js';
import { RUNTIME_PROFILES } from '../profiles/index.js';
import { assertBackgroundTasks } from '../ports/backgroundTasks.js';

const cloudflareProfile = RUNTIME_PROFILES['cloudflare-worker'];
const cloudflareBackgroundProfile = defineRuntimeDescriptor({
  ...cloudflareProfile,
  ports: Object.fromEntries(Object.entries(cloudflareProfile.ports).map(([id, declaration]) => [id, {
    ...declaration,
    available: id === 'httpTransport' || id === 'backgroundTasks',
    ...(['httpTransport', 'backgroundTasks'].includes(id) ? { planned: undefined } : {}),
  }])),
});

export function createCloudflareBackgroundTasks({ executionContext, onError = () => {}, onDrop = () => {} }) {
  if (typeof executionContext?.waitUntil !== 'function') {
    throw new TypeError('Cloudflare executionContext.waitUntil is required');
  }

  let closed = false;
  const pending = new Set();
  const report = (callback, ...args) => {
    try { callback(...args); } catch {}
  };

  return assertBackgroundTasks({
    enqueue(task) {
      if (closed) {
        report(onDrop, task);
        return;
      }

      let registered = false;
      let dropReported = false;
      const ownedTask = Promise.resolve().then(() => {
        if (!registered) {
          if (!dropReported) report(onDrop, task);
          return;
        }
        return task.execute();
      }).catch((error) => report(onError, error, task)).finally(() => pending.delete(ownedTask));

      pending.add(ownedTask);
      try {
        executionContext.waitUntil(ownedTask);
        registered = true;
      } catch {
        dropReported = true;
        pending.delete(ownedTask);
        report(onDrop, task);
      }
    },
    async close() {
      closed = true;
      await Promise.all([...pending]);
    },
  });
}

export function composeCloudflareBackgroundRuntime({ executionContext, httpTransport, onError, onDrop }) {
  const backgroundTasks = createCloudflareBackgroundTasks({ executionContext, onError, onDrop });
  const runtime = composeRuntime(cloudflareBackgroundProfile, { httpTransport, backgroundTasks });
  return Object.freeze({ ...runtime, backgroundTasks });
}
