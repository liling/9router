import { describe, expect, it } from 'vitest';
import {
  assertApiKeyRepository,
  API_KEY_REPOSITORY_METHODS,
  API_KEY_UPDATE_PATCH_FIELDS,
} from '../../../../open-sse/runtime/ports/persistence/apiKeyRepository.js';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../../../open-sse/runtime/ports/persistence/errors.js';
import { apiKeyRepositoryContract } from './api-key-repository.contract.js';

function createMemoryRepository() {
  const records = new Map();
  return {
    async findById(id) { return records.get(id) ?? null; },
    async findByKey(key) { return [...records.values()].find((record) => record.key === key) ?? null; },
    async list() {
      return [...records.values()].sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      ));
    },
    async insert(record) {
      if (records.has(record.id) || [...records.values()].some((item) => item.key === record.key)) {
        throw new PersistenceConflictError();
      }
      records.set(record.id, { ...record, access: { ...record.access, allow: [...record.access.allow] } });
      return records.get(record.id);
    },
    async update(id, patch) {
      const current = records.get(id);
      if (!current) throw new PersistenceNotFoundError();
      if (Object.hasOwn(patch, 'key') && [...records.values()].some((item) => item.id !== id && item.key === patch.key)) {
        throw new PersistenceConflictError();
      }
      const next = { ...current };
      for (const field of API_KEY_UPDATE_PATCH_FIELDS) {
        if (Object.hasOwn(patch, field)) next[field] = patch[field];
      }
      if (Object.hasOwn(patch, 'access')) next.access = { ...patch.access, allow: [...patch.access.allow] };
      records.set(id, next);
      return next;
    },
    async delete(id) { return records.delete(id); },
  };
}

apiKeyRepositoryContract(async () => createMemoryRepository());

describe('ApiKeyRepository port', () => {
  it('declares only aggregate operations and accepts an asynchronous implementation', () => {
    expect(API_KEY_REPOSITORY_METHODS).toEqual(['findById', 'findByKey', 'list', 'insert', 'update', 'delete']);
    expect(API_KEY_UPDATE_PATCH_FIELDS).toEqual(['key', 'name', 'machineId', 'isActive', 'access']);
    const repository = Object.fromEntries(API_KEY_REPOSITORY_METHODS.map((method) => [method, async () => {}]));
    expect(assertApiKeyRepository(repository)).toBe(repository);
    expect(() => assertApiKeyRepository({ ...repository, findByKey: undefined })).toThrow('ApiKeyRepository.findByKey');
  });
});
