import { afterEach, describe, expect, it } from 'vitest';
import { getRuntime, resetRuntimeForTests } from '../../open-sse/runtime/context.js';
import { register } from '../../src/instrumentation.js';
import { stopLocalComposition } from '../../src/lib/runtime/localComposition.js';

describe('production Local composition root', () => {
  afterEach(async () => {
    await stopLocalComposition();
    resetRuntimeForTests();
    delete process.env.RUNTIME_PROFILE;
    delete process.env.NEXT_RUNTIME;
  });

  it('installs only injected ports once and shuts down owned timers cleanly', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.RUNTIME_PROFILE = 'local-node';
    await register();
    await register();

    const runtime = getRuntime();
    expect(runtime.descriptor.background).toMatchObject({ model: 'process-timers', durable: false });
    expect(runtime.assertPort('httpTransport', { authoritative: true }).fetch).toBeTypeOf('function');
    expect(runtime.assertPort('persistence', { authoritative: true }).list).toBeTypeOf('function');
    expect(runtime.assertPort('ephemeral', { authoritative: true }).put).toBeTypeOf('function');
    expect(runtime.assertPort('backgroundTasks').enqueue).toBeTypeOf('function');
    expect(runtime.assertPort('scheduler').schedule).toBeTypeOf('function');
    expect(await runtime.assertPort('persistence').list()).toBeInstanceOf(Array);

    await stopLocalComposition();
    await stopLocalComposition();
  });
});
