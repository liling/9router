import { CAPABILITIES, normalizeCapability } from './capabilities.js';

const PORT_IDS = ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob', 'process'];
const RUNTIME_KINDS = ['process', 'container', 'function', 'isolate'];
const LIFECYCLES = ['long-lived', 'instance-restart', 'function-scoped', 'isolate-scoped'];

export function validateRuntimeDescriptor(descriptor) {
  const issues = [];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return ['descriptor must be an object'];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(descriptor.id ?? '')) issues.push('id must be a stable kebab-case string');
  if (!descriptor.label) issues.push('label is required');
  if (!RUNTIME_KINDS.includes(descriptor.kind)) issues.push('kind is invalid');
  if (!descriptor.runtimeFamily) issues.push('runtimeFamily is required');
  if (!descriptor.lifecycle || !LIFECYCLES.includes(descriptor.lifecycle.model)) issues.push('lifecycle.model is invalid');
  if (!descriptor.scale || !['single', 'multi'].includes(descriptor.scale.instanceModel) || typeof descriptor.scale.stickySessions !== 'boolean') issues.push('scale is invalid');
  if (!descriptor.filesystem || typeof descriptor.filesystem.importable !== 'boolean' || !['persistent', 'volume', 'ephemeral', 'none'].includes(descriptor.filesystem.writable) || typeof descriptor.filesystem.durableAcrossRestarts !== 'boolean') issues.push('filesystem is invalid');
  if (!descriptor.background || !['process-timers', 'bounded-waituntil', 'platform-scheduled', 'none'].includes(descriptor.background.model) || typeof descriptor.background.survivesResponse !== 'boolean') issues.push('background is invalid');
  if (!Array.isArray(descriptor.capabilityTags) || descriptor.capabilityTags.some((tag) => !CAPABILITIES.includes(normalizeCapability(tag)))) issues.push('capabilityTags contains an unknown capability');
  if (!descriptor.ports || PORT_IDS.some((id) => !descriptor.ports[id] || typeof descriptor.ports[id].available !== 'boolean')) issues.push('ports must declare all eight port availabilities');
  for (const key of ['httpTransport', 'persistence', 'ephemeral']) {
    if (descriptor.ports?.[key]?.available && typeof descriptor.ports[key].authoritative !== 'boolean') issues.push(`ports.${key}.authoritative is required`);
  }
  if (descriptor.ports?.ephemeral?.available && typeof descriptor.ports.ephemeral.shared !== 'boolean') issues.push('ports.ephemeral.shared is required');
  return issues;
}

export function defineRuntimeDescriptor(descriptor) {
  const issues = validateRuntimeDescriptor(descriptor);
  if (issues.length) throw new TypeError(`Invalid RuntimeDescriptor: ${issues.join('; ')}`);
  return deepFreeze(structuredClone(descriptor));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
