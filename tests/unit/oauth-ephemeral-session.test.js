import { afterEach, describe, expect, it } from 'vitest';
import { composeRuntime, installRuntime, resetRuntimeForTests } from '../../open-sse/runtime/context.js';
import { createLocalEphemeralStore } from '../../open-sse/runtime/adapters/localEphemeralStore.js';
import {
  clearCodexSession,
  clearXaiSession,
  consumeCodexSession,
  consumeXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  registerCodexSession,
  registerXaiSession,
} from '../../src/lib/oauth/utils/server.js';

afterEach(() => resetRuntimeForTests());

function installLocalStore(now) {
  installRuntime(composeRuntime('local-node', {
    httpTransport: {},
    persistence: {},
    ephemeral: createLocalEphemeralStore({ now }),
    backgroundTasks: {},
    scheduler: {},
  }));
}

describe('Codex/xAI ephemeral OAuth sessions', () => {
  it.each([
    ['Codex', registerCodexSession, getCodexSessionStatus, consumeCodexSession, clearCodexSession],
    ['xAI', registerXaiSession, getXaiSessionStatus, consumeXaiSession, clearXaiSession],
  ])('%s sessions reject duplicate states and expire after five minutes', async (_provider, register, peek, consume, remove) => {
    let now = 1000;
    installLocalStore(() => now);
    const session = { state: 'state-1', codeVerifier: 'verifier', redirectUri: 'http://localhost/callback' };

    await expect(register(session)).resolves.toBe(true);
    await expect(register(session)).resolves.toBe(false);
    await expect(peek(session.state)).resolves.toMatchObject({ status: 'pending', codeVerifier: 'verifier' });
    await expect(consume(session.state)).resolves.toMatchObject({ status: 'pending' });
    await expect(consume(session.state)).resolves.toBeNull();

    await register({ ...session, state: 'concurrent' });
    const consumedSessions = await Promise.all([
      consume('concurrent'),
      consume('concurrent'),
    ]);
    expect(consumedSessions.filter(Boolean)).toHaveLength(1);

    await register({ ...session, state: 'expires' });
    now += 300000;
    await expect(peek('expires')).resolves.toBeNull();
    await remove('state-1');
  });
});
