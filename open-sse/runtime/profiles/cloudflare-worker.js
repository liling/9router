import { createProfile } from './profile.js';

export default createProfile({
  id: 'cloudflare-worker', label: 'Cloudflare Workers', kind: 'isolate', runtimeFamily: 'workerd',
  lifecycle: { model: 'isolate-scoped', gracefulShutdown: false, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'none', durableAcrossRestarts: false },
  background: { model: 'bounded-waituntil', survivesResponse: false },
  capabilityTags: ['http-fetch'],
  availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob'],
  authoritativePorts: ['httpTransport'],
});
