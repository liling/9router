import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresApiKeyRepository } from '../../../../open-sse/runtime/adapters/postgres/apiKeyRepository.js';
import { PersistenceConflictError } from '../../../../open-sse/runtime/ports/persistence/errors.js';
import { apiKeyRepositoryContract } from './api-key-repository.contract.js';

const databaseName = 'api_keys_contract_test';
let containerId;
let repository;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

beforeAll(async () => {
  containerId = docker([
    'run', '--detach', '--rm', '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_USER=contract',
    '--env', 'POSTGRES_PASSWORD=contract-only',
    '--env', `POSTGRES_DB=${databaseName}`,
    'postgres:16.15-alpine',
  ]);

  const readyDeadline = Date.now() + 60000;
  let readiness;
  let containerLogs = '';
  while (Date.now() < readyDeadline) {
    const check = spawnSync('docker', ['exec', containerId, 'pg_isready', '-U', 'contract', '-d', databaseName]);
    const logs = spawnSync('docker', ['logs', containerId], { encoding: 'utf8' });
    containerLogs = `${logs.stdout || ''}${logs.stderr || ''}`;
    if (check.status === 0 && containerLogs.includes('PostgreSQL init process complete; ready for start up.')) {
      readiness = check;
      break;
    }
    await delay(250);
  }
  if (!readiness || readiness.status !== 0) {
    throw new Error(`Temporary PostgreSQL container did not become ready: ${containerLogs}`);
  }

  const schema = readFileSync(new URL('../../../../open-sse/runtime/adapters/postgres/schema.sql', import.meta.url), 'utf8');
  docker([
    'exec', '-i', containerId, 'psql', '-U', 'contract', '-d', databaseName, '-v', 'ON_ERROR_STOP=1',
  ], {
    input: `${schema}\nINSERT INTO api_keys (id, key, name, machine_id, is_active, created_at, access_restricted, access_allow) VALUES ('seed-id', 'seed-key', 'Seed', NULL, TRUE, '2025-01-01T00:00:00.000Z', FALSE, '[]'::jsonb);`,
  });

  const portBinding = docker(['port', containerId, '5432/tcp']);
  const port = Number(portBinding.slice(portBinding.lastIndexOf(':') + 1));
  repository = createPostgresApiKeyRepository({
    connectionString: `postgresql://contract:contract-only@127.0.0.1:${port}/${databaseName}`,
    max: 1,
    idleTimeoutMillis: 1000,
  });
  await repository.list();
}, 70000);

afterAll(async () => {
  try {
    await repository?.close();
  } finally {
    if (containerId) spawnSync('docker', ['rm', '--force', containerId]);
  }
});

apiKeyRepositoryContract(async () => repository);

describe('PostgreSQL ApiKeyRepository constraints', () => {
  it('maps duplicate ids and duplicate keys to persistence conflicts', async () => {
    const record = {
      id: 'unique-probe-id',
      key: 'unique-probe-key',
      name: 'Unique probe',
      machineId: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      access: { restricted: false, allow: [] },
    };
    await repository.insert(record);
    await expect(repository.insert({ ...record, key: 'different-key' })).rejects.toBeInstanceOf(PersistenceConflictError);
    await expect(repository.insert({ ...record, id: 'different-id' })).rejects.toBeInstanceOf(PersistenceConflictError);
    await repository.delete(record.id);
  });
});
