import { createProfile } from './profile.js';

export default createProfile({
  id: 'cloudflare-worker', label: 'Cloudflare Workers', kind: 'isolate', runtimeFamily: 'workerd',
  lifecycle: { model: 'isolate-scoped', gracefulShutdown: false, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'ephemeral', durableAcrossRestarts: false, scope: 'request' },
  background: { model: 'bounded-waituntil', survivesResponse: true, durable: false },
  capabilityTags: ['http-fetch'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  sharedEphemeral: true,
  plannedPorts: {
    persistence: { adapter: 'D1 ApiKeyRepository', authoritative: true, note: 'Available after the Cloudflare production root injects it.' },
    ephemeral: { adapter: 'D1 ephemeral store', shared: true, note: 'Available after the Cloudflare production root injects it.' },
    backgroundTasks: { adapter: 'ExecutionContext.waitUntil', note: 'Available after the Cloudflare production root injects it.' },
    lease: { adapter: 'DO', note: 'Planned distributed lease adapter.' },
    secret: { adapter: 'env/KV', note: 'Planned secret provider.' },
    scheduler: { adapter: 'Cron Triggers', note: 'Planned config-declared schedules; declarations must match the platform configuration.' },
    blob: { adapter: 'R2', note: 'Planned blob adapter.' },
  },
});
