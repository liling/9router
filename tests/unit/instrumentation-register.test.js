import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntime, resetRuntimeForTests } from '../../open-sse/runtime/context.js';
import { stopLocalComposition } from '../../src/lib/runtime/localComposition.js';

const lifecycleMocks = vi.hoisted(() => ({
  start: vi.fn(),
  createTasks: vi.fn(() => ({ enqueue: vi.fn() })),
  createScheduler: vi.fn(() => ({ schedule: vi.fn() })),
}));

vi.mock('@/lib/consoleLogBuffer', () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock('@/lib/modelCatalog/sync', () => ({ startModelCatalogSync: lifecycleMocks.start }));
vi.mock('open-sse/providers/catalogOverride.js', () => ({ installCatalogSource: vi.fn() }));
vi.mock('../../open-sse/runtime/adapters/localBackgroundTasks.js', () => ({ createLocalBackgroundTasks: lifecycleMocks.createTasks }));
vi.mock('../../open-sse/runtime/adapters/localIntervalScheduler.js', () => ({ createLocalIntervalScheduler: lifecycleMocks.createScheduler }));

const environmentKeys = ['NEXT_RUNTIME', 'VERCEL', 'K_SERVICE', 'CF_PAGES', 'RUNTIME_PROFILE', 'NODE_ENV'];
let originalEnvironment;

describe('instrumentation register runtime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
    resetRuntimeForTests();
    for (const key of environmentKeys) delete process.env[key];
  });

  afterEach(async () => {
    await stopLocalComposition();
    resetRuntimeForTests();
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it('installs Local Node with authoritative ephemeral storage and real HTTP fetch', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.RUNTIME_PROFILE = 'local-node';
    const { register } = await import('../../src/instrumentation.js');
    await register();

    expect(getRuntime().descriptor.id).toBe('local-node');
    expect(getRuntime().assertPort('persistence', { authoritative: true }).list).toBeTypeOf('function');
    expect(getRuntime().assertPort('backgroundTasks').enqueue).toBeTypeOf('function');
    expect(getRuntime().assertPort('scheduler').schedule).toBeTypeOf('function');
    const ephemeral = getRuntime().assertPort('ephemeral', { authoritative: true });
    await ephemeral.put('register-test', 'key', { value: 42 }, { ttlMs: 10_000, ifAbsent: true });
    await expect(ephemeral.put('register-test', 'key', { value: 43 }, { ttlMs: 10_000, ifAbsent: true })).rejects.toMatchObject({ code: 'EPHEMERAL_CONFLICT' });
    expect(await ephemeral.peek('register-test', 'key')).toEqual({ value: 42 });
    expect(await ephemeral.consume('register-test', 'key')).toEqual({ value: 42 });
    expect(await ephemeral.consume('register-test', 'key')).toBeNull();

    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const transport = getRuntime().assertPort('httpTransport', { authoritative: true });
      const response = await transport.fetch(`http://127.0.0.1:${address.port}`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each(['VERCEL', 'K_SERVICE', 'CF_PAGES'])('does not install Local runtime under %s', async (key) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'production';
    process.env[key] = '1';
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    expect(lifecycleMocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ['production profile unset', { NODE_ENV: 'production' }],
    ['unknown explicit profile', { NODE_ENV: 'development', RUNTIME_PROFILE: 'custom-node' }],
    ['Vercel profile without Vercel marker', { NODE_ENV: 'production', RUNTIME_PROFILE: 'vercel-node' }],
    ['Pages profile without Pages marker', { NODE_ENV: 'production', RUNTIME_PROFILE: 'cloudflare-worker' }],
    ['Local profile contradicted by Cloud Run', { NODE_ENV: 'production', RUNTIME_PROFILE: 'local-node', K_SERVICE: 'service' }],
  ])('fails closed for %s: no Local runtime or catalog Scheduler', async (_label, env) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    Object.assign(process.env, env);
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    expect(lifecycleMocks.start).not.toHaveBeenCalled();
    expect(lifecycleMocks.createTasks).not.toHaveBeenCalled();
  });

  it.each(['local-node', 'local-bun', 'docker-node'])('installs Local runtime and starts catalog Scheduler for %s', async (profile) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_PROFILE = profile;
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(getRuntime().descriptor.id).toBe('local-node');
    expect(getRuntime().assertPort('persistence', { authoritative: true }).list).toBeTypeOf('function');
    expect(getRuntime().assertPort('scheduler').schedule).toBeTypeOf('function');
  });

  it.each([
    ['vercel-node', { VERCEL: '1' }],
    ['cloudflare-worker', { CF_PAGES: '1' }],
  ])('uses explicit non-Local profile %s regardless of vendor marker', async (profile, markers) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_PROFILE = profile;
    Object.assign(process.env, markers);
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    expect(lifecycleMocks.start).not.toHaveBeenCalled();
    expect(lifecycleMocks.createTasks).not.toHaveBeenCalled();
  });

  it.each(['VERCEL', 'CF_PAGES'])('does not override explicit Local profile with %s marker', async (key) => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NODE_ENV = 'production';
    process.env.RUNTIME_PROFILE = 'local-node';
    process.env[key] = '1';
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(getRuntime().descriptor.id).toBe('local-node');
    expect(getRuntime().assertPort('persistence', { authoritative: true }).list).toBeTypeOf('function');
  });

  it('does not install Local runtime for edge', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
    expect(lifecycleMocks.start).not.toHaveBeenCalled();
    expect(lifecycleMocks.createTasks).not.toHaveBeenCalled();
  });
});
