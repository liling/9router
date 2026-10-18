import { defineRuntimeDescriptor } from '../descriptor.js';

const PORTS = Object.freeze(['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process']);

export function createProfile({ id, label, kind, runtimeFamily, lifecycle, scale, filesystem, background, capabilityTags, availablePorts, authoritativePorts = [], sharedEphemeral = false, plannedPorts = {} }) {
  const authoritative = new Set(authoritativePorts);
  const available = new Set(availablePorts);
  return defineRuntimeDescriptor({
    id, label, kind, runtimeFamily,
    lifecycle: { gracefulShutdown: false, coldStartExpected: false, ...lifecycle },
    scale: { stickySessions: false, ...scale },
    filesystem,
    background,
    capabilityTags,
    ports: Object.fromEntries(PORTS.map((port) => [port, {
      available: available.has(port),
      ...( ['httpTransport', 'persistence', 'ephemeral'].includes(port) ? { authoritative: authoritative.has(port) } : {}),
      ...(port === 'ephemeral' ? { shared: sharedEphemeral } : {}),
      ...(plannedPorts[port] ? { planned: plannedPorts[port] } : {}),
    }])),
  });
}
