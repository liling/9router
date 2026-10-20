import { describe, expect, it, beforeEach } from 'vitest';
import { CAPABILITIES, assertCapabilities, hasCapabilities, RuntimeCapabilityError } from '../../../open-sse/runtime/capabilities.js';
import { assertRuntimeDependencies, composeRuntime, extendRuntime, getRuntime, installRuntime, resetRuntimeForTests } from '../../../open-sse/runtime/context.js';
import { defineRuntimeDescriptor, validateRuntimeDescriptor } from '../../../open-sse/runtime/descriptor.js';
import { RUNTIME_PROFILES } from '../../../open-sse/runtime/profiles/index.js';
import { createProfile } from '../../../open-sse/runtime/profiles/profile.js';
import { assertBackgroundTasks, BACKGROUND_TASK_METHODS } from '../../../open-sse/runtime/ports/backgroundTasks.js';
import { assertScheduler, SCHEDULER_METHODS } from '../../../open-sse/runtime/ports/scheduler.js';

function testCompositionProfile(id, availablePorts) {
  const profile = RUNTIME_PROFILES[id];
  const available = new Set(availablePorts);
  return {
    ...profile,
    id: `${id}-composition-test`,
    ports: Object.fromEntries(Object.entries(profile.ports).map(([port, declaration]) => [port, {
      ...declaration,
      available: available.has(port),
      ...(Object.hasOwn(declaration, 'authoritative') ? {
        authoritative: available.has(port) && (declaration.authoritative || ['persistence', 'ephemeral'].includes(port)),
      } : {}),
    }])),
  };
}

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
      const expectedAvailablePorts = ['httpTransport'];
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].available)).toEqual(expectedAvailablePorts);
      expect(profile.ports.httpTransport.authoritative).toBe(true);
      expect(profile.ports.persistence.available).toBe(expectedAvailablePorts.includes('persistence'));
      if (!profile.ports.persistence.available) expect(profile.ports.persistence).toMatchObject({ authoritative: false, planned: expect.any(Object) });
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].planned)).toEqual(expectedPlannedPorts[id]);
    }
    expect(Object.keys(RUNTIME_PROFILES['local-node'].ports)).toHaveLength(9);
    for (const [id, profile] of Object.entries(RUNTIME_PROFILES)) {
      const expected = ['httpTransport'];
      expect(profile.ports.backgroundTasks.available).toBe(expected.includes('backgroundTasks'));
      expect(profile.ports.scheduler.available).toBe(expected.includes('scheduler'));
    }
    expect(RUNTIME_PROFILES['cloudflare-worker'].ports.ephemeral).toMatchObject({ available: false, authoritative: false, shared: true });
    expect(RUNTIME_PROFILES['local-node'].ports.ephemeral).toMatchObject({ available: false, authoritative: false, shared: false });
    expect(RUNTIME_PROFILES['cloud-run'].ports.ephemeral).toMatchObject({ available: false, planned: { shared: true } });
    expect(RUNTIME_PROFILES['cloudflare-worker'].ports.ephemeral).toMatchObject({ available: false, authoritative: false, shared: true });
    expect(RUNTIME_PROFILES['cloud-run'].ports.backgroundTasks.planned.note).toMatch(/Best-effort/);
    expect(RUNTIME_PROFILES['cloudflare-worker'].background).toEqual({ model: 'bounded-waituntil', survivesResponse: true, durable: false });
    expect(RUNTIME_PROFILES['vercel-node'].background).toEqual({ model: 'bounded-waituntil', survivesResponse: true, durable: false });
    expect(RUNTIME_PROFILES['cloudflare-worker'].filesystem).toEqual({ importable: true, writable: 'ephemeral', durableAcrossRestarts: false, scope: 'request' });
    expect(RUNTIME_PROFILES['cloudflare-worker'].capabilityTags).not.toContain('fs-ephemeral');
    expect(RUNTIME_PROFILES['cloud-run'].capabilityTags).not.toContain('stable-timers');
    expect(RUNTIME_PROFILES['cloud-run'].background).toEqual({ model: 'process-timers', survivesResponse: false, durable: false });
    for (const id of ['local-node', 'docker-node', 'local-bun']) {
      expect(RUNTIME_PROFILES[id].background).toEqual({
        model: 'process-timers',
        survivesResponse: true,
        durable: false,
      });
    }
  });

  it('composes the declared runtime ports and rejects missing ports at composition', () => {
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    const httpTransport = { fetch: () => new Response() };
    const profile = testCompositionProfile('cloudflare-worker', ['httpTransport', 'persistence', 'ephemeral', 'backgroundTasks']);
    const context = composeRuntime(profile, {
      httpTransport, persistence: {}, ephemeral: {}, backgroundTasks: {},
    });
    expect(installRuntime(context)).toBe(context);
    expect(getRuntime().assertPort('httpTransport')).toBe(httpTransport);
    expect(context.assertPort('persistence', { authoritative: true })).toBe(context.ports.persistence);
    expect(() => composeRuntime(profile, { httpTransport })).toThrow(expect.objectContaining({
      code: 'RUNTIME_PORT_UNAVAILABLE', capability: 'persistence', runtime: 'cloudflare-worker-composition-test',
    }));
    expect(() => context.assertPort('unknown')).toThrow(expect.objectContaining({ code: 'RUNTIME_PORT_UNAVAILABLE' }));
  });

  it('rejects supplied adapters for unavailable ports and missing adapters for available ports', () => {
    const cloudflare = testCompositionProfile('cloudflare-worker', ['httpTransport']);
    expect(() => composeRuntime(cloudflare, { httpTransport: {}, persistence: {}, ephemeral: {}, backgroundTasks: {}, scheduler: {} })).toThrow(TypeError);
    const localNode = testCompositionProfile('local-node', ['httpTransport', 'persistence', 'ephemeral', 'backgroundTasks', 'scheduler']);
    expect(() => composeRuntime(localNode, { httpTransport: {}, persistence: {}, ephemeral: {}, backgroundTasks: {}, scheduler: {} })).not.toThrow();
    const persistenceRequiredDescriptor = {
      ...localNode,
      id: 'local-node-with-required-persistence',
      ports: {
        ...localNode.ports,
        persistence: { ...localNode.ports.persistence, available: true },
      },
    };
    expect(() => composeRuntime(persistenceRequiredDescriptor, { httpTransport: {}, ephemeral: {}, backgroundTasks: {}, scheduler: {} })).toThrow(expect.objectContaining({
      code: 'RUNTIME_PORT_UNAVAILABLE', capability: 'persistence', runtime: 'local-node-with-required-persistence',
    }));
  });

  it('fails closed on required dependencies and extends composed contexts per request', () => {
    expect(() => assertRuntimeDependencies({}, ['D1'])).toThrow('Missing required runtime dependency: D1');
    const profile = testCompositionProfile('cloudflare-worker', ['httpTransport', 'persistence', 'ephemeral', 'backgroundTasks']);
    const context = composeRuntime(profile, {
      httpTransport: {}, persistence: {}, ephemeral: {}, backgroundTasks: {},
    });
    const requestTasks = {};
    const requestContext = extendRuntime(context, { backgroundTasks: requestTasks });
    expect(requestContext.assertPort('backgroundTasks')).toBe(requestTasks);
    expect(context.assertPort('backgroundTasks')).not.toBe(requestTasks);
    expect(() => extendRuntime(context, { scheduler: {} })).toThrow(/unavailable port/);
  });

  it('requires durable background semantics and bounded work to survive the response', () => {
    const cloudflare = RUNTIME_PROFILES['cloudflare-worker'];
    expect(validateRuntimeDescriptor({ ...cloudflare, background: { ...cloudflare.background, survivesResponse: false } })).toContain('bounded-waituntil must survive the response');
    expect(validateRuntimeDescriptor({ ...cloudflare, background: { model: 'process-timers', survivesResponse: true, durable: true } })).toContain('process-timers must not claim durable completion');
    expect(validateRuntimeDescriptor({ ...cloudflare, background: { ...cloudflare.background, durable: true } })).toContain('bounded-waituntil must not claim durable completion');
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
      background: { model: 'process-timers', survivesResponse: true, durable: false },
      capabilityTags: ['http-fetch', 'fs-persistent', 'stable-timers'],
      availablePorts: ['httpTransport'],
      authoritativePorts: ['httpTransport'],
    });
    const futureProfiles = { ...RUNTIME_PROFILES, [deno.id]: deno };
    const context = composeRuntime('deno-future', { httpTransport: {} }, futureProfiles);
    expect(context.hasCapability('http-fetch')).toBe(true);
  });
});
