import { createProfile } from './profile.js';

export default createProfile({
  id: 'local-bun', label: 'Local Bun', kind: 'process', runtimeFamily: 'bun',
  lifecycle: { model: 'long-lived', gracefulShutdown: true, coldStartExpected: false },
  scale: { instanceModel: 'single' },
  filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
  background: { model: 'process-timers', survivesResponse: true },
  capabilityTags: ['http-fetch', 'http-proxy', 'h2-duplex', 'node-stream', 'fs-persistent', 'process-spawn', 'local-socket', 'stable-timers'],
  availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob', 'process'],
  authoritativePorts: ['httpTransport', 'persistence', 'ephemeral'],
});
