import { createProfile } from './profile.js';

export default createProfile({
  id: 'vercel-node', label: 'Vercel Node.js Functions', kind: 'function', runtimeFamily: 'node',
  lifecycle: { model: 'function-scoped', gracefulShutdown: false, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'ephemeral', durableAcrossRestarts: false },
  background: { model: 'bounded-waituntil', survivesResponse: false },
  capabilityTags: ['http-fetch', 'node-stream', 'fs-ephemeral'],
  availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob'],
  authoritativePorts: ['httpTransport'],
});
