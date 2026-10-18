import { describe, expect, it } from 'vitest';
import { assertApiKeyRepository, API_KEY_REPOSITORY_METHODS } from '../../../../open-sse/runtime/ports/persistence/apiKeyRepository.js';

describe('ApiKeyRepository port', () => {
  it('declares only aggregate operations and accepts an asynchronous implementation', () => {
    expect(API_KEY_REPOSITORY_METHODS).toEqual(['findById', 'findByKey', 'list', 'insert', 'update', 'delete']);
    const repository = Object.fromEntries(API_KEY_REPOSITORY_METHODS.map((method) => [method, async () => {}]));
    expect(assertApiKeyRepository(repository)).toBe(repository);
    expect(() => assertApiKeyRepository({ ...repository, findByKey: undefined })).toThrow('ApiKeyRepository.findByKey');
  });
});
