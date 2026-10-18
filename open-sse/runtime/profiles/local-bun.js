import { createProfile } from './profile.js';

export default createProfile({
  id: 'local-bun', label: 'Local Bun', kind: 'process', runtimeFamily: 'bun',
  lifecycle: { model: 'long-lived', gracefulShutdown: true, coldStartExpected: false },
  scale: { instanceModel: 'single' },
  filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
  background: { model: 'process-timers', survivesResponse: true, durable: true },
  capabilityTags: ['http-fetch', 'http-proxy', 'h2-duplex', 'node-stream', 'fs-persistent', 'process-spawn', 'local-socket', 'stable-timers'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  plannedPorts: {
    persistence: { adapter: 'async repository wrapper', authoritative: true, note: 'Planned migration step 1.' },
    ephemeral: { adapter: 'process Map', authoritative: true, shared: false, note: 'Single-instance only.' },
    lease: { adapter: 'process lock', note: 'Single-instance only.' },
    secret: { adapter: 'DB settings + env', note: 'Planned secret provider.' },
    backgroundTasks: { adapter: 'process queue', note: 'Planned local best-effort task adapter.' },
    scheduler: { adapter: 'setInterval', note: 'Planned dynamically registered local schedules.' },
    blob: { adapter: 'filesystem directory', note: 'Planned local blob adapter.' },
    process: { adapter: 'spawn/machine identity', note: 'Local-only optional capability.' },
  },
});
