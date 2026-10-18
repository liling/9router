import { createProfile } from './profile.js';

export default createProfile({
  id: 'cloud-run', label: 'Google Cloud Run', kind: 'container', runtimeFamily: 'node',
  lifecycle: { model: 'instance-restart', gracefulShutdown: true, coldStartExpected: true },
  scale: { instanceModel: 'multi' },
  filesystem: { importable: true, writable: 'ephemeral', durableAcrossRestarts: false },
  background: { model: 'process-timers', survivesResponse: false },
  capabilityTags: ['http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream', 'fs-ephemeral', 'stable-timers'],
  availablePorts: ['httpTransport'],
  authoritativePorts: ['httpTransport'],
  sharedEphemeral: false,
  plannedPorts: {
    persistence: { adapter: 'external SQL', authoritative: true, note: 'Planned cross-instance authoritative storage.' },
    ephemeral: { adapter: 'shared backend', shared: true, note: 'Planned shared ephemeral state adapter.' },
    lease: { adapter: 'distributed lease', note: 'Planned cross-instance lease adapter.' },
    secret: { adapter: 'Secret Manager/env', note: 'Planned secret provider.' },
    background: { adapter: 'instance timers', note: 'Best-effort only; does not promise survival after response.' },
    blob: { adapter: 'GCS', note: 'Planned blob adapter.' },
    process: { adapter: 'process APIs', note: 'Opt-in only; not available in the default composition.' },
  },
});
