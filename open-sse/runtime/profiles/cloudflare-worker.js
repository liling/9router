import { createProfile } from './profile.js';

export default createProfile({
  id: 'cloudflare-worker', label: 'Cloudflare Workers', kind: 'isolate', runtimeFamily: 'workerd',
  lifecycle: { model: 'isolate-scoped', gracefulShutdown: false, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'none', durableAcrossRestarts: false },
  background: { model: 'bounded-waituntil', survivesResponse: false },
  capabilityTags: ['http-fetch'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  plannedPorts: {
    persistence: { adapter: 'D1', authoritative: true, note: 'Planned async authoritative persistence adapter.' },
    ephemeral: { adapter: 'KV/DO', shared: true, note: 'Planned shared ephemeral state adapter.' },
    lease: { adapter: 'DO', note: 'Planned distributed lease adapter.' },
    secret: { adapter: 'env/KV', note: 'Planned secret provider.' },
    blob: { adapter: 'R2', note: 'Planned blob adapter.' },
  },
});
