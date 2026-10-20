import { createProfile } from './profile.js';

export default createProfile({
  id: 'local-node', label: 'Local Node.js', kind: 'process', runtimeFamily: 'node',
  lifecycle: { model: 'long-lived', gracefulShutdown: true, coldStartExpected: false },
  scale: { instanceModel: 'single' },
  filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
  background: { model: 'process-timers', survivesResponse: true, durable: false },
  capabilityTags: ['http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream', 'fs-persistent', 'process-spawn', 'local-socket', 'stable-timers'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  sharedEphemeral: false,
  plannedPorts: {
    persistence: { adapter: 'SQLite ApiKeyRepository', authoritative: true, note: 'Available after the Local composition root injects it.' },
    ephemeral: { adapter: 'local ephemeral store', shared: false, note: 'Available after the Local composition root injects it.' },
    backgroundTasks: { adapter: 'process background tasks', note: 'Available after the Local composition root injects it.' },
    scheduler: { adapter: 'interval scheduler', note: 'Available after the Local composition root injects it.' },
    lease: { adapter: 'process lock', note: 'Single-instance only.' },
    secret: { adapter: 'DB settings + env', note: 'Planned secret provider.' },
    blob: { adapter: 'filesystem directory', note: 'Planned local blob adapter.' },
    process: { adapter: 'spawn/machine identity', note: 'Local-only optional capability.' },
  },
});
