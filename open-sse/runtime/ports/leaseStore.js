export const LEASE_STORE_METHODS = Object.freeze(['acquire', 'renew', 'release']);

export function assertLeaseStore(port) {
  for (const method of LEASE_STORE_METHODS) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`LeaseStore.${method} is required`);
  }
  return port;
}
