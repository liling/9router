export const API_KEY_REPOSITORY_METHODS = Object.freeze([
  'findById', 'findByKey', 'list', 'insert', 'update', 'delete',
]);

/**
 * `update(id, patch)` atomically replaces only own-present patch fields.
 * `id` and `createdAt` are immutable; null clears nullable `name` and
 * `machineId`, while `access` is replaced as a whole when present.
 */
export const API_KEY_UPDATE_PATCH_FIELDS = Object.freeze([
  'key', 'name', 'machineId', 'isActive', 'access',
]);

export function assertApiKeyRepository(repository) {
  for (const method of API_KEY_REPOSITORY_METHODS) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`ApiKeyRepository.${method} must be asynchronous`);
    }
  }
  return repository;
}
