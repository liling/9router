import { describe, expect, it } from 'vitest';
import {
  assertEphemeralStore,
  EPHEMERAL_STORE_METHODS,
  EphemeralStoreConflictError,
  EphemeralStoreInvalidTtlError,
} from '../../../open-sse/runtime/ports/ephemeralStore.js';
import { ephemeralStoreContract } from './ephemeral-store.contract.js';

function createMemoryStore({ now }) {
  const entries = new Map();
  const keyOf = (namespace, key) => JSON.stringify([namespace, key]);
  const liveEntry = (namespace, key) => {
    const id = keyOf(namespace, key);
    const entry = entries.get(id);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      entries.delete(id);
      return null;
    }
    return entry;
  };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    async put(namespace, key, value, { ttlMs, ifAbsent = false } = {}) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new EphemeralStoreInvalidTtlError();
      if (typeof namespace !== 'string' || !namespace || typeof key !== 'string' || !key) throw new TypeError('namespace and key are required');
      const id = keyOf(namespace, key);
      if (ifAbsent && liveEntry(namespace, key)) throw new EphemeralStoreConflictError();
      entries.set(id, { value: copy(value), expiresAt: now() + ttlMs });
    },
    async peek(namespace, key) {
      const entry = liveEntry(namespace, key);
      return entry ? copy(entry.value) : null;
    },
    async consume(namespace, key) {
      const entry = liveEntry(namespace, key);
      if (!entry) return null;
      entries.delete(keyOf(namespace, key));
      return copy(entry.value);
    },
    async delete(namespace, key) { return entries.delete(keyOf(namespace, key)); },
  };
}

ephemeralStoreContract(createMemoryStore, { describe, it });

describe('EphemeralStore port', () => {
  it('declares the domain operations and requires async methods', () => {
    expect(EPHEMERAL_STORE_METHODS).toEqual(['put', 'peek', 'consume', 'delete']);
    const port = Object.fromEntries(EPHEMERAL_STORE_METHODS.map((method) => [method, async () => {}]));
    expect(assertEphemeralStore(port)).toBe(port);
    expect(() => assertEphemeralStore({ ...port, consume: undefined })).toThrow('EphemeralStore.consume');
  });
});
