import { describe, expect, it, beforeEach } from 'vitest';
import { CAPABILITIES, assertCapabilities, hasCapabilities, RuntimeCapabilityError } from '../../../open-sse/runtime/capabilities.js';
import { composeRuntime, getRuntime, installRuntime, resetRuntimeForTests } from '../../../open-sse/runtime/context.js';
import { defineRuntimeDescriptor, validateRuntimeDescriptor } from '../../../open-sse/runtime/descriptor.js';
import { RUNTIME_PROFILES } from '../../../open-sse/runtime/profiles/index.js';
import { createProfile } from '../../../open-sse/runtime/profiles/profile.js';

const localAdapters = Object.fromEntries(['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob', 'process'].map((name) => [name, {}]));

describe('runtime capability contracts', () => {
  beforeEach(() => resetRuntimeForTests());

  it('validates and freezes descriptors and profile data', () => {
    expect(validateRuntimeDescriptor(RUNTIME_PROFILES['local-node'])).toEqual([]);
    expect(Object.isFrozen(RUNTIME_PROFILES['local-node'].ports.persistence)).toBe(true);
    expect(() => defineRuntimeDescriptor({ id: 'Not valid' })).toThrow(/Invalid RuntimeDescriptor/);
    expect(CAPABILITIES).toHaveLength(10);
  });

  it('matches current and legacy capability tags without vendor coupling', () => {
    const descriptor = RUNTIME_PROFILES['local-node'];
    expect(hasCapabilities(descriptor, ['proxy-transport', 'node-fs'])).toBe(true);
    expect(() => assertCapabilities(descriptor, ['unknown-capability'])).toThrow(RuntimeCapabilityError);
  });

  it('installs context and explicitly rejects missing runtime or ports', () => {
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    const context = composeRuntime('local-node', localAdapters);
    expect(installRuntime(context)).toBe(context);
    expect(getRuntime().assertPort('persistence', { authoritative: true })).toBe(localAdapters.persistence);
    expect(() => context.assertPort('persistence', { authoritative: true })).not.toThrow();
    expect(() => composeRuntime('local-node', {})).toThrow(expect.objectContaining({ code: 'RUNTIME_PORT_UNAVAILABLE' }));
    expect(() => context.assertPort('unknown')).toThrow(expect.objectContaining({ code: 'RUNTIME_PORT_UNAVAILABLE' }));
  });

  it('matches a future Deno profile without Core changes', () => {
    const deno = createProfile({
      id: 'deno-future', label: 'Deno Future', kind: 'process', runtimeFamily: 'deno',
      lifecycle: { model: 'long-lived' }, scale: { instanceModel: 'single' },
      filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
      background: { model: 'process-timers', survivesResponse: true },
      capabilityTags: ['http-fetch', 'fs-persistent', 'stable-timers'],
      availablePorts: ['httpTransport', 'persistence', 'ephemeral', 'lease', 'secret', 'background', 'blob'],
      authoritativePorts: ['httpTransport', 'persistence', 'ephemeral'],
    });
    const futureProfiles = { ...RUNTIME_PROFILES, [deno.id]: deno };
    const context = composeRuntime('deno-future', { ...localAdapters, process: undefined }, futureProfiles);
    expect(context.hasCapability('http-fetch')).toBe(true);
  });
});
