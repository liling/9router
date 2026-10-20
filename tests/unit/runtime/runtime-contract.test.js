import { describe, expect, it, beforeEach } from 'vitest';
import { CAPABILITIES, assertCapabilities, hasCapabilities, RuntimeCapabilityError } from '../../../open-sse/runtime/capabilities.js';
import { assertRuntimeDependencies, composeRuntime, extendRuntime, getRuntime, installRuntime, resetRuntimeForTests } from '../../../open-sse/runtime/context.js';
import { defineRuntimeDescriptor, validateRuntimeDescriptor } from '../../../open-sse/runtime/descriptor.js';
import { RUNTIME_PROFILES } from '../../../open-sse/runtime/profiles/index.js';
import { createProfile } from '../../../open-sse/runtime/profiles/profile.js';
import { assertBackgroundTasks, BACKGROUND_TASK_METHODS } from '../../../open-sse/runtime/ports/backgroundTasks.js';
import { assertScheduler, SCHEDULER_METHODS } from '../../../open-sse/runtime/ports/scheduler.js';
import { composeCloudflareBaseRuntime, composeCloudflareRequestRuntime } from '../../../open-sse/runtime/adapters/cloudflareProduction.js';
import { createCloudflareBackgroundTasks } from '../../../open-sse/runtime/adapters/cloudflareBackgroundTasks.js';
import { createD1ApiKeyRepository } from '../../../open-sse/runtime/adapters/d1/apiKeyRepository.js';
import { createD1EphemeralStore } from '../../../open-sse/runtime/adapters/d1/ephemeralStore.js';

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
      'cloudflare-worker': ['lease', 'secret', 'scheduler', 'blob'],
      'cloud-run': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'vercel-node': ['persistence', 'ephemeral', 'secret', 'backgroundTasks', 'scheduler'],
      'local-node': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'docker-node': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
      'local-bun': ['persistence', 'ephemeral', 'lease', 'secret', 'backgroundTasks', 'scheduler', 'blob', 'process'],
    };
    for (const [id, profile] of Object.entries(RUNTIME_PROFILES)) {
      const expectedAvailablePorts = id === 'cloudflare-worker'
        ? ['httpTransport', 'persistence', 'ephemeral', 'backgroundTasks']
        : ['httpTransport'];
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].available)).toEqual(expectedAvailablePorts);
      expect(profile.ports.httpTransport.authoritative).toBe(true);
      expect(profile.ports.persistence.available).toBe(expectedAvailablePorts.includes('persistence'));
      if (!profile.ports.persistence.available) expect(profile.ports.persistence).toMatchObject({ authoritative: false, planned: expect.any(Object) });
      expect(Object.keys(profile.ports).filter((port) => profile.ports[port].planned)).toEqual(expectedPlannedPorts[id]);
    }
    expect(Object.keys(RUNTIME_PROFILES['local-node'].ports)).toHaveLength(9);
    for (const [id, profile] of Object.entries(RUNTIME_PROFILES)) {
      const expected = id === 'cloudflare-worker' ? ['httpTransport', 'backgroundTasks'] : ['httpTransport'];
      expect(profile.ports.backgroundTasks.available).toBe(expected.includes('backgroundTasks'));
      expect(profile.ports.scheduler.available).toBe(expected.includes('scheduler'));
    }
    expect(RUNTIME_PROFILES['cloudflare-worker'].ports.ephemeral).toMatchObject({ available: true, authoritative: true, shared: true });
    expect(RUNTIME_PROFILES['local-node'].ports.ephemeral).toMatchObject({ available: false, authoritative: false, shared: false });
    expect(RUNTIME_PROFILES['cloud-run'].ports.ephemeral).toMatchObject({ available: false, planned: { shared: true } });
    expect(RUNTIME_PROFILES['cloudflare-worker'].ports.scheduler).toMatchObject({ available: false, planned: expect.any(Object) });
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

  it('composes isolated request runtimes without mutating the installed base', async () => {
    const base = composeCloudflareBaseRuntime(async () => new Response('ok'));
    installRuntime(base);
    const makeDb = () => {
      const records = new Map();
      return { prepare() { return { bind(...values) { this.values = values; return this; }, async run() {
        const [namespace, key, value] = this.values;
        records.set(`${namespace}:${key}`, value);
        return { meta: { changes: 1 } };
      }, async first() {
        const [namespace, key] = this.values;
        const value = records.get(`${namespace}:${key}`);
        return value ? { value_json: value } : null;
      } }; } };
    };
    const waitsA = [], waitsB = [];
    const factories = {
      createApiKeyRepository: createD1ApiKeyRepository,
      createEphemeralStore: createD1EphemeralStore,
      createBackgroundTasks: createCloudflareBackgroundTasks,
    };
    const a = composeCloudflareRequestRuntime({ ...factories, baseRuntime: base, env: { DB: makeDb() }, executionContext: { waitUntil: (p) => waitsA.push(p) } });
    const b = composeCloudflareRequestRuntime({ ...factories, baseRuntime: base, env: { DB: makeDb() }, executionContext: { waitUntil: (p) => waitsB.push(p) } });
    await Promise.all([
      a.assertPort('ephemeral').put('ns', 'key', 'a', { ttlMs: 10000 }),
      b.assertPort('ephemeral').put('ns', 'key', 'b', { ttlMs: 10000 }),
    ]);
    expect(await a.assertPort('ephemeral').peek('ns', 'key')).toBe('a');
    expect(await b.assertPort('ephemeral').peek('ns', 'key')).toBe('b');
    a.assertPort('backgroundTasks').enqueue({ id: 'a', execute: async () => {} });
    b.assertPort('backgroundTasks').enqueue({ id: 'b', execute: async () => {} });
    await Promise.all([...waitsA, ...waitsB]);
    expect(waitsA).toHaveLength(1);
    expect(waitsB).toHaveLength(1);
    expect(getRuntime()).toBe(base);
    for (const port of ['persistence', 'ephemeral', 'backgroundTasks']) expect(() => base.assertPort(port)).toThrow(RuntimeCapabilityError);
    expect(() => composeCloudflareRequestRuntime({ ...factories, baseRuntime: base, env: {}, executionContext: { waitUntil() {} } })).toThrow(/D1/);
    expect(() => composeCloudflareRequestRuntime({ ...factories, baseRuntime: base, env: { DB: makeDb() }, executionContext: {} })).toThrow(/background registration/);
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
