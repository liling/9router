import { assertCapabilities, RuntimeCapabilityError } from './capabilities.js';
import { validateRuntimeDescriptor } from './descriptor.js';
import { RUNTIME_PROFILES } from './profiles/index.js';

const PORT_IDS = Object.freeze(['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob', 'process']);
let installedRuntime;

export function composeRuntime(profileId, adapters = {}, profiles = RUNTIME_PROFILES) {
  const descriptor = typeof profileId === 'string' ? profiles[profileId] : profileId;
  if (!descriptor) throw new RuntimeCapabilityError('RUNTIME_PORT_UNAVAILABLE', { capability: 'profile', runtime: profileId });
  const issues = validateRuntimeDescriptor(descriptor);
  if (issues.length) throw new TypeError(`Invalid RuntimeDescriptor: ${issues.join('; ')}`);
  const ports = {};
  for (const id of PORT_IDS) {
    const declaration = descriptor.ports[id];
    const implementation = adapters[id];
    if (declaration.available && !implementation) {
      throw new RuntimeCapabilityError('RUNTIME_PORT_UNAVAILABLE', { capability: id, runtime: descriptor.id });
    }
    if (!declaration.available && implementation) {
      throw new TypeError(`Adapter supplied for unavailable port: ${id}`);
    }
    if (implementation) ports[id] = implementation;
  }
  return Object.freeze({
    descriptor,
    ports: Object.freeze(ports),
    hasCapability: (tag) => {
      try { assertCapabilities(descriptor, [tag]); return true; } catch { return false; }
    },
    assertPort: (id, { authoritative = false } = {}) => {
      const declaration = descriptor.ports[id];
      if (!PORT_IDS.includes(id) || !declaration?.available || !ports[id] || (authoritative && declaration.authoritative !== true)) {
        throw new RuntimeCapabilityError('RUNTIME_PORT_UNAVAILABLE', { capability: id, runtime: descriptor.id });
      }
      return ports[id];
    },
  });
}

export function installRuntime(context) {
  if (!context?.descriptor || !context?.ports) throw new TypeError('A composed RuntimeContext is required');
  installedRuntime = context;
  return context;
}

export function getRuntime() {
  if (!installedRuntime) throw new RuntimeCapabilityError('RUNTIME_CONTEXT_NOT_INSTALLED');
  return installedRuntime;
}

export function resetRuntimeForTests() {
  installedRuntime = undefined;
}
