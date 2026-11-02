import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudflareSecretProvider } from '../../../open-sse/runtime/adapters/cloudflareSecretProvider.js';
import { createD1ConnectionRepository } from '../../../open-sse/runtime/adapters/d1/connectionRepository.js';
import { credentialFallbackIterator, resolveConnectionCredentials } from '../../../open-sse/runtime/credentials/resolver.js';

function row(id, overrides = {}) {
  return { id, providerId: 'openai', authType: 'api_key', secretName: `opaque_${id}`, enabledModels: [], ...overrides };
}

function repository(rows, calls = []) {
  return {
    async getSelectionStrategy() { return 'fill_first'; },
    async listEligibleConnections(input) {
      calls.push(input);
      return { connections: rows.filter((item) => item.providerId === input.providerId && !input.excludedIds.includes(item.id)), retryAfterAt: null };
    },
    async markUnavailable() {},
  };
}

test('selects exact provider and returns only fresh allowlisted credential data', async () => {
  const token = crypto.randomUUID();
  const result = await resolveConnectionCredentials({
    providerId: 'openai', model: 'model-a',
    repository: repository([row('first'), row('other', { providerId: 'anthropic' })]),
    secretProvider: createCloudflareSecretProvider({ opaque_first: JSON.stringify({ version: 1, authType: 'api_key', apiKey: token }) }),
  });
  assert.equal(result.apiKey, token);
  assert.equal(result.connectionId, 'first');
  assert.equal(Object.isFrozen(result), true);
  assert.equal('secretName' in result, false);
  assert.equal('_connection' in result, false);
});

test('fails closed for absent, malformed, expired, mismatched and unknown-field envelopes', async () => {
  const values = [null, '{', JSON.stringify({ version: 1, authType: 'api_key', apiKey: ' ' }),
    JSON.stringify({ version: 1, authType: 'oauth', apiKey: crypto.randomUUID() }),
    JSON.stringify({ version: 1, authType: 'api_key', apiKey: crypto.randomUUID(), refreshToken: crypto.randomUUID() })];
  for (const value of values) {
    await assert.rejects(resolveConnectionCredentials({
      providerId: 'openai', model: 'm', repository: repository([row('x')]),
      secretProvider: { async getSecret() { return value; } },
    }), (error) => error.code === 'credential_unavailable');
  }
  const expired = JSON.stringify({ version: 1, authType: 'oauth', accessToken: crypto.randomUUID(), expiresAt: Date.now() - 1 });
  await assert.rejects(resolveConnectionCredentials({
    providerId: 'github', model: 'm', repository: repository([row('expired', { providerId: 'github', authType: 'oauth' })]),
    secretProvider: { async getSecret() { return expired; } },
  }), (error) => error.code === 'credential_unavailable');
});

test('rejects unsupported provider auth without reading a secret', async () => {
  let reads = 0;
  await assert.rejects(resolveConnectionCredentials({
    providerId: 'openai', model: 'm', repository: repository([row('x', { authType: 'oauth' })]),
    secretProvider: { async getSecret() { reads += 1; } },
  }), (error) => error.code === 'credential_unavailable');
  assert.equal(reads, 0);
});

test('aborts on source failure and emits neither opaque name nor secret value', async () => {
  const secret = crypto.randomUUID();
  await assert.rejects(resolveConnectionCredentials({
    providerId: 'openai', model: 'm', repository: repository([row('x')]),
    secretProvider: { async getSecret() { throw new Error(`${secret} opaque_x`); } },
  }), (error) => {
    assert.equal(error.code, 'credential_source_unavailable');
    assert.equal(JSON.stringify(error).includes(secret), false);
    assert.equal(error.message.includes('opaque_x'), false);
    return true;
  });
});

test('retries only same-provider connections with request-local exclusions', async () => {
  const calls = [];
  const iterator = credentialFallbackIterator({
    providerId: 'openai', model: 'm', repository: repository([row('bad'), row('good'), row('foreign', { providerId: 'anthropic' })], calls),
    secretProvider: { async getSecret(name) { return name === 'opaque_bad' ? '{' : JSON.stringify({ version: 1, authType: 'api_key', apiKey: crypto.randomUUID() }); } },
  });
  const first = await iterator.next();
  assert.equal(first.value.connectionId, 'good');
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(calls.map((call) => call.excludedIds), [[], ['good']]);
});

test('concurrent requests keep resolved credentials isolated', async () => {
  const tokenA = crypto.randomUUID();
  const tokenB = crypto.randomUUID();
  const resolve = (id, token) => resolveConnectionCredentials({
    providerId: 'openai', model: 'm', repository: repository([row(id)]),
    secretProvider: createCloudflareSecretProvider({ [`opaque_${id}`]: JSON.stringify({ version: 1, authType: 'api_key', apiKey: token }) }),
  });
  const [a, b] = await Promise.all([resolve('a', tokenA), resolve('b', tokenB)]);
  assert.equal(a.apiKey, tokenA);
  assert.equal(b.apiKey, tokenB);
  assert.equal(a.apiKey === b.apiKey, false);
});

test('D1 adapter scopes lookup to exact provider and orders deterministic fill-first candidates', async () => {
  let statement = '';
  let values;
  const adapter = createD1ConnectionRepository({ prepare(sql) {
    statement = sql;
    return { bind(...args) { values = args; return this; }, async all() { return { results: [] }; }, async first() { return null; } };
  } });
  assert.equal(await adapter.getSelectionStrategy({ providerId: 'openai' }), 'fill_first');
  await adapter.listEligibleConnections({ providerId: 'openai', model: 'm' });
  assert.match(statement, /provider_id = \?/);
  assert.match(statement, /ORDER BY priority ASC, id ASC/);
  assert.deepEqual(values, ['openai', 'm']);
});

test('rejects a configured non-fill-first strategy explicitly', async () => {
  const repo = repository([row('x')]);
  repo.getSelectionStrategy = async () => 'round_robin';
  await assert.rejects(resolveConnectionCredentials({
    providerId: 'openai', model: 'm', repository: repo,
    secretProvider: { async getSecret() { throw new Error('must not read'); } },
  }), (error) => error.code === 'credential_strategy_unsupported');
});

test('retains only cooldown expiry for an all-locked candidate result', async () => {
  const expiry = Date.now() + 30_000;
  const repo = repository([]);
  repo.listEligibleConnections = async () => ({ connections: [], retryAfterAt: expiry });
  await assert.rejects(resolveConnectionCredentials({
    providerId: 'openai', model: 'm', repository: repo,
    secretProvider: { async getSecret() { return null; } },
  }), (error) => {
    assert.equal(error.code, 'credential_unavailable');
    assert.equal(error.retryAfterAt, expiry);
    assert.equal(Object.keys(error).some((key) => /id|secret|connection/i.test(key)), false);
    return true;
  });
});
