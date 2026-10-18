export const EPHEMERAL_STORE_METHODS = Object.freeze(['get', 'set', 'delete', 'consume']);

export function assertEphemeralStore(port) {
  for (const method of EPHEMERAL_STORE_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`EphemeralStore.${method} is required`);
  }
  return port;
}
