import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntime, resetRuntimeForTests } from '../../open-sse/runtime/context.js';

vi.mock('@/lib/consoleLogBuffer', () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock('@/lib/modelCatalog/sync', () => ({ startModelCatalogSync: vi.fn() }));
vi.mock('open-sse/providers/catalogOverride.js', () => ({ installCatalogSource: vi.fn() }));

const environmentKeys = ['NEXT_RUNTIME', 'VERCEL', 'K_SERVICE', 'CF_PAGES'];
let originalEnvironment;

describe('instrumentation register runtime composition', () => {
  beforeEach(() => {
    originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
    resetRuntimeForTests();
    for (const key of environmentKeys) delete process.env[key];
  });

  afterEach(() => {
    resetRuntimeForTests();
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  it('installs Local Node with authoritative ephemeral storage and real HTTP fetch', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../../src/instrumentation.js');
    await register();

    expect(getRuntime().descriptor.id).toBe('local-node');
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
    process.env[key] = '1';
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
  });

  it('does not install Local runtime for edge', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../../src/instrumentation.js');
    await register();
    expect(() => getRuntime()).toThrow(expect.objectContaining({ code: 'RUNTIME_CONTEXT_NOT_INSTALLED' }));
  });
});
