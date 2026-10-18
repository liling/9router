import { createProfile } from './profile.js';

export default createProfile({
  id: 'docker-node', label: 'Docker Node.js', kind: 'container', runtimeFamily: 'node',
  lifecycle: { model: 'long-lived', gracefulShutdown: true, coldStartExpected: false },
  scale: { instanceModel: 'single' },
  filesystem: { importable: true, writable: 'volume', durableAcrossRestarts: true },
  background: { model: 'process-timers', survivesResponse: true },
  capabilityTags: ['http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream', 'fs-persistent', 'process-spawn', 'local-socket', 'stable-timers'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  plannedPorts: {
    persistence: { adapter: 'async repository wrapper', authoritative: true, note: 'Planned migration step 1; durable only on mounted volume.' },
    ephemeral: { adapter: 'process Map', authoritative: true, shared: false, note: 'Single-instance only.' },
    lease: { adapter: 'process lock', note: 'Single-instance only.' },
    secret: { adapter: 'DB settings + env', note: 'Planned secret provider.' },
    background: { adapter: 'process timers', note: 'Planned local background task adapter.' },
    blob: { adapter: 'filesystem directory', note: 'Planned local blob adapter.' },
    process: { adapter: 'spawn/machine identity', note: 'Local-only optional capability.' },
  },
});
