import assert from 'node:assert/strict';
import { EphemeralStoreConflictError, EphemeralStoreInvalidTtlError } from '../../../open-sse/runtime/ports/ephemeralStore.js';

export function ephemeralStoreContract(createStore, { describe, it }) {
  describe('EphemeralStore contract', () => {
    it('isolates namespaces and returns JSON values without shared references', async () => {
      const store = await createStore({ now: () => 100 });
      const value = { verifier: 'secret', nested: { count: 1 } };
      await store.put('oauth', 'state-a', value, { ttlMs: 50 });
      value.nested.count = 2;
      assert.deepEqual(await store.peek('oauth', 'state-a'), { verifier: 'secret', nested: { count: 1 } });
      assert.equal(await store.peek('other', 'state-a'), null);
      assert.equal(await store.peek('oauth', 'missing'), null);
    });

    it('expires values at the deadline without waiting on real time', async () => {
      let now = 100;
      const store = await createStore({ now: () => now });
      await store.put('oauth', 'state', { ok: true }, { ttlMs: 10 });
      assert.deepEqual(await store.peek('oauth', 'state'), { ok: true });
      now = 110;
      assert.equal(await store.peek('oauth', 'state'), null);
      assert.equal(await store.consume('oauth', 'state'), null);
    });

    it('supports create-if-absent and atomic consume-once', async () => {
      const store = await createStore({ now: () => 1 });
      await store.put('oauth', 'state', { codeVerifier: 'v' }, { ttlMs: 100, ifAbsent: true });
      await assert.rejects(store.put('oauth', 'state', {}, { ttlMs: 100, ifAbsent: true }), EphemeralStoreConflictError);
      const results = await Promise.all(Array.from({ length: 8 }, () => store.consume('oauth', 'state')));
      assert.equal(results.filter(Boolean).length, 1);
      assert.deepEqual(results.find(Boolean), { codeVerifier: 'v' });
      assert.equal(await store.consume('oauth', 'state'), null);
    });

    it('overwrites by default, deletes idempotently, and validates TTL', async () => {
      const store = await createStore({ now: () => 1 });
      await store.put('oauth', 'state', { value: 1 }, { ttlMs: 100 });
      await store.put('oauth', 'state', { value: 2 }, { ttlMs: 100 });
      assert.deepEqual(await store.consume('oauth', 'state'), { value: 2 });
      assert.equal(await store.delete('oauth', 'state'), false);
      await assert.rejects(store.put('oauth', 'bad', {}, { ttlMs: 0 }), EphemeralStoreInvalidTtlError);
    });
  });
}
