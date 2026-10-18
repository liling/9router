import { createProfile } from './profile.js';

export default createProfile({
  id: 'cloud-run', label: 'Google Cloud Run', kind: 'container', runtimeFamily: 'node',
  lifecycle: { model: 'instance-restart', gracefulShutdown: true, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'ephemeral', durableAcrossRestarts: false },
  background: { model: 'process-timers', survivesResponse: true },
  capabilityTags: ['http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream', 'fs-ephemeral', 'stable-timers'],
  availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob'],
  authoritativePorts: ['httpTransport'],
  sharedEphemeral: false,
});
