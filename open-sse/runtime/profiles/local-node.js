import { createProfile } from './profile.js';

export default createProfile({
  id: 'local-node', label: 'Local Node.js', kind: 'process', runtimeFamily: 'node',
  lifecycle: { model: 'long-lived', gracefulShutdown: true, coldStartExpected: false },
  scale: { instanceModel: 'single' },
  filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
  background: { model: 'process-timers', survivesResponse: true },
  capabilityTags: ['http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream', 'fs-persistent', 'process-spawn', 'local-socket', 'stable-timers'],
  availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob', 'process'],
  authoritativePorts: ['httpTransport', 'persistence', 'ephemeral'],
});
