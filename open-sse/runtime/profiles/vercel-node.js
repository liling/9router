import { createProfile } from './profile.js';

export default createProfile({
  id: 'vercel-node', label: 'Vercel Node.js Functions', kind: 'function', runtimeFamily: 'node',
  lifecycle: { model: 'function-scoped', gracefulShutdown: false, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'ephemeral', durableAcrossRestarts: false },
  background: { model: 'bounded-waituntil', survivesResponse: true, durable: false },
  capabilityTags: ['http-fetch', 'node-stream', 'fs-ephemeral'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  plannedPorts: {
    persistence: { adapter: 'KV/PG', authoritative: true, note: 'Planned authoritative persistence adapter.' },
    ephemeral: { adapter: 'shared KV', shared: true, note: 'Planned shared ephemeral state adapter.' },
    secret: { adapter: 'environment', note: 'Planned secret provider.' },
    backgroundTasks: { adapter: 'waitUntil', note: 'Planned bounded, non-durable post-response work; credential refresh remains lazy-on-read.' },
    scheduler: { adapter: 'Vercel Cron', note: 'Planned config-declared schedules; declarations must match the platform configuration.' },
  },
});
