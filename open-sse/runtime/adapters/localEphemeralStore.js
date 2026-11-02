import { EphemeralStoreConflictError, EphemeralStoreInvalidTtlError } from '../ports/ephemeralStore.js';

export function createLocalEphemeralStore({ now = Date.now } = {}) {
  const entries = new Map();
  const idFor = (namespace, key) => JSON.stringify([namespace, key]);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const liveEntry = (id) => {
    const entry = entries.get(id);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      entries.delete(id);
      return null;
    }
    return entry;
  };

  return Object.freeze({
    async put(namespace, key, value, { ttlMs, ifAbsent = false } = {}) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new EphemeralStoreInvalidTtlError();
      if (typeof namespace !== 'string' || !namespace || typeof key !== 'string' || !key) throw new TypeError('namespace and key are required');
      const id = idFor(namespace, key);
      if (ifAbsent && liveEntry(id)) throw new EphemeralStoreConflictError();
      entries.set(id, { value: copy(value), expiresAt: now() + ttlMs });
    },
    async peek(namespace, key) {
      const entry = liveEntry(idFor(namespace, key));
      return entry ? copy(entry.value) : null;
    },
    async consume(namespace, key) {
      const id = idFor(namespace, key);
      const entry = liveEntry(id);
      if (!entry) return null;
      entries.delete(id);
      return copy(entry.value);
    },
    async delete(namespace, key) {
      return entries.delete(idFor(namespace, key));
    },
  });
}
