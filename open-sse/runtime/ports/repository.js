export const REPOSITORY_METHODS = Object.freeze(['get', 'list', 'create', 'update', 'delete']);

export function assertRepository(port) {
  for (const method of REPOSITORY_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`Repository.${method} must be asynchronous`);
  }
  return port;
}
