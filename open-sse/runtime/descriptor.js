import { CAPABILITIES, normalizeCapability } from './capabilities.js';

const PORT_IDS = ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'];
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
  if (!descriptor.filesystem || typeof descriptor.filesystem.importable !== 'boolean' || !['persistent', 'volume', 'ephemeral', 'none'].includes(descriptor.filesystem.writable) || typeof descriptor.filesystem.durableAcrossRestarts !== 'boolean' || (descriptor.filesystem.scope !== undefined && !['request', 'instance'].includes(descriptor.filesystem.scope))) issues.push('filesystem is invalid');
  if (!descriptor.background || !['process-timers', 'bounded-waituntil', 'platform-scheduled', 'none'].includes(descriptor.background.model) || typeof descriptor.background.survivesResponse !== 'boolean' || typeof descriptor.background.durable !== 'boolean') issues.push('background is invalid');
  if (descriptor.background?.model === 'bounded-waituntil' && descriptor.background.survivesResponse !== true) issues.push('bounded-waituntil must survive the response');
  if (!Array.isArray(descriptor.capabilityTags) || descriptor.capabilityTags.some((tag) => !CAPABILITIES.includes(normalizeCapability(tag)))) issues.push('capabilityTags contains an unknown capability');
  if (!descriptor.ports || PORT_IDS.some((id) => !descriptor.ports[id] || typeof descriptor.ports[id].available !== 'boolean') || Object.keys(descriptor.ports ?? {}).some((id) => !PORT_IDS.includes(id))) issues.push('ports must declare exactly the nine port availabilities');
  for (const key of ['httpTransport', 'persistence', 'ephemeral']) {
    if (descriptor.ports?.[key]?.available && typeof descriptor.ports[key].authoritative !== 'boolean') issues.push(`ports.${key}.authoritative is required`);
  }
  if (descriptor.ports?.ephemeral?.available && typeof descriptor.ports.ephemeral.shared !== 'boolean') issues.push('ports.ephemeral.shared is required');
  for (const [portId, declaration] of Object.entries(descriptor.ports ?? {})) {
    if (declaration.planned === undefined) continue;
    const planned = declaration.planned;
    if (!planned || typeof planned !== 'object' || typeof planned.adapter !== 'string' || !planned.adapter.trim() || typeof planned.note !== 'string') {
      issues.push(`ports.${portId}.planned must declare adapter and note`);
      continue;
    }
    for (const key of ['authoritative', 'shared']) {
      if (planned[key] !== undefined && typeof planned[key] !== 'boolean') issues.push(`ports.${portId}.planned.${key} must be boolean`);
    }
  }
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
