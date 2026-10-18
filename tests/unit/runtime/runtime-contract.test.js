import { describe, expect, it, beforeEach } from 'vitest';
import { CAPABILITIES, assertCapabilities, hasCapabilities, RuntimeCapabilityError } from '../../../open-sse/runtime/capabilities.js';
import { composeRuntime, getRuntime, installRuntime, resetRuntimeForTests } from '../../../open-sse/runtime/context.js';
import { defineRuntimeDescriptor, validateRuntimeDescriptor } from '../../../open-sse/runtime/descriptor.js';
import { RUNTIME_PROFILES } from '../../../open-sse/runtime/profiles/index.js';
import { createProfile } from '../../../open-sse/runtime/profiles/profile.js';
import { assertBackgroundTasks, BACKGROUND_TASK_METHODS } from '../../../open-sse/runtime/ports/backgroundTasks.js';
import { assertScheduler, SCHEDULER_METHODS } from '../../../open-sse/runtime/ports/scheduler.js';

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

  it('declares only implemented ports and records planned adapters separately', () => {
    const expectedPlannedPorts = {
      'cloudflare-worker': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob'],
      'cloud-run': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'vercel-node': ['persistence', 'ephemeral', 'secret', 'backgroundTasks', 'scheduler'],
      'local-node': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'docker-node': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'local-bun': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
    };
    for (const [id, profile] of Object.entries(RUNTIME_PROFILES)) {
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].available)).toEqual(['httpTransport']);
      expect(profile.ports.httpTransport.authoritative).toBe(true);
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].planned)).toEqual(expectedPlannedPorts[id]);
    }
    expect(Object.keys(RUNTIME_PROFILES['local-node'].ports)).toHaveLength(9);
    for (const profile of Object.values(RUNTIME_PROFILES)) {
      expect(profile.ports.backgroundTasks.available).toBe(false);
      expect(profile.ports.scheduler.available).toBe(false);
    }
    expect(RUNTIME_PROFILES['cloudflare-worker'].ports.ephemeral.planned.shared).toBe(true);
    expect(RUNTIME_PROFILES['local-node'].ports.ephemeral.planned).toMatchObject({ authoritative: true, shared: false });
    expect(RUNTIME_PROFILES['cloud-run'].ports.backgroundTasks.planned.note).toMatch(/Best-effort/);
    expect(RUNTIME_PROFILES['cloudflare-worker'].background).toEqual({ model: 'bounded-waituntil', survivesResponse: true, durable: false });
    expect(RUNTIME_PROFILES['vercel-node'].background).toEqual({ model: 'bounded-waituntil', survivesResponse: true, durable: false });
    expect(RUNTIME_PROFILES['cloudflare-worker'].filesystem).toEqual({ importable: true, writable: 'ephemeral', durableAcrossRestarts: false, scope: 'request' });
    expect(RUNTIME_PROFILES['cloudflare-worker'].capabilityTags).not.toContain('fs-ephemeral');
    expect(RUNTIME_PROFILES['cloud-run'].capabilityTags).not.toContain('stable-timers');
    expect(RUNTIME_PROFILES['cloud-run'].background).toEqual({ model: 'process-timers', survivesResponse: false, durable: false });
    for (const id of ['local-node', 'docker-node', 'local-bun']) expect(RUNTIME_PROFILES[id].background.durable).toBe(true);
  });

  it('composes Cloudflare with only the implemented HTTP port and rejects planned ports at use', () => {
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    const httpTransport = { fetch: () => new Response() };
    const context = composeRuntime('cloudflare-worker', { httpTransport });
    expect(installRuntime(context)).toBe(context);
    expect(getRuntime().assertPort('httpTransport')).toBe(httpTransport);
    expect(() => context.assertPort('persistence')).toThrow(expect.objectContaining({
      code: 'RUNTIME_PORT_UNAVAILABLE', capability: 'persistence', runtime: 'cloudflare-worker',
    }));
    expect(() => context.assertPort('persistence', { authoritative: true })).toThrow(expect.objectContaining({
      code: 'RUNTIME_PORT_UNAVAILABLE', capability: 'persistence', runtime: 'cloudflare-worker',
    }));
    expect(() => context.assertPort('unknown')).toThrow(expect.objectContaining({ code: 'RUNTIME_PORT_UNAVAILABLE' }));
  });

  it('rejects supplied adapters for unavailable ports and missing adapters for available ports', () => {
    expect(() => composeRuntime('cloudflare-worker', { httpTransport: {}, persistence: {} })).toThrow(TypeError);
    const localNode = RUNTIME_PROFILES['local-node'];
    expect(() => composeRuntime('local-node', { httpTransport: {} })).not.toThrow();
    const persistenceRequiredDescriptor = {
      ...localNode,
      id: 'local-node-with-required-persistence',
      ports: {
        ...localNode.ports,
        persistence: { ...localNode.ports.persistence, available: true },
      },
    };
    expect(() => composeRuntime(persistenceRequiredDescriptor, { httpTransport: {} })).toThrow(expect.objectContaining({
      code: 'RUNTIME_PORT_UNAVAILABLE', capability: 'persistence', runtime: 'local-node-with-required-persistence',
    }));
  });

  it('requires durable background semantics and bounded work to survive the response', () => {
    const cloudflare = RUNTIME_PROFILES['cloudflare-worker'];
    expect(validateRuntimeDescriptor({ ...cloudflare, background: { ...cloudflare.background, survivesResponse: false } })).toContain('bounded-waituntil must survive the response');
    expect(validateRuntimeDescriptor({ ...cloudflare, background: { model: 'none', survivesResponse: false } })).toContain('background is invalid');
    expect(validateRuntimeDescriptor({ ...cloudflare, ports: { ...cloudflare.ports, legacyBackground: { available: false } } })).toContain('ports must declare exactly the nine port availabilities');
  });

  it('keeps BackgroundTasks and Scheduler as independent one-method contracts', () => {
    const enqueue = () => {};
    const schedule = () => {};
    expect(BACKGROUND_TASK_METHODS).toEqual(['enqueue']);
    expect(SCHEDULER_METHODS).toEqual(['schedule']);
    expect(assertBackgroundTasks({ enqueue })).toEqual({ enqueue });
    expect(() => assertBackgroundTasks({ schedule })).toThrow('BackgroundTasks.enqueue is required');
    expect(assertScheduler({ schedule })).toEqual({ schedule });
    expect(() => assertScheduler({ enqueue })).toThrow('Scheduler.schedule is required');
  });

  it('matches a future Deno profile without Core changes', () => {
    const deno = createProfile({
      id: 'deno-future', label: 'Deno Future', kind: 'process', runtimeFamily: 'deno',
      lifecycle: { model: 'long-lived' }, scale: { instanceModel: 'single' },
      filesystem: { importable: true, writable: 'persistent', durableAcrossRestarts: true },
      background: { model: 'process-timers', survivesResponse: true, durable: true },
      capabilityTags: ['http-fetch', 'fs-persistent', 'stable-timers'],
      availablePorts: ['httpTransport'],
      authoritativePorts: ['httpTransport'],
    });
    const futureProfiles = { ...RUNTIME_PROFILES, [deno.id]: deno };
    const context = composeRuntime('deno-future', { httpTransport: {} }, futureProfiles);
    expect(context.hasCapability('http-fetch')).toBe(true);
  });
});
