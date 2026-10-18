export const API_KEY_REPOSITORY_METHODS = Object.freeze([
  'findById', 'findByKey', 'list', 'insert', 'update', 'delete',
]);

export function assertApiKeyRepository(repository) {
  for (const method of API_KEY_REPOSITORY_METHODS) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`ApiKeyRepository.${method} must be asynchronous`);
    }
  }
  return repository;
}
