import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../../../open-sse/runtime/ports/persistence/errors.js';

export function apiKeyRepositoryContract(createRepository, { describe, it }) {
  describe('ApiKeyRepository contract', () => {
    it('provides asynchronous lookups and stable createdAt ordering', async () => {
      const repository = await createRepository();
      const rows = await repository.list();
      assert.deepEqual(rows, [...rows].sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )));
      assert.equal(await repository.findById('missing-id'), null);
      assert.equal(await repository.findByKey('missing-key'), null);
    });

    it('inserts and updates records, reporting duplicate ids or keys as conflicts', async () => {
      const repository = await createRepository();
      const suffix = randomUUID();
      const record = { id: `contract-${suffix}`, key: `contract-key-${suffix}`, name: 'Contract', machineId: 'machine-contract',
        isActive: true, createdAt: '2026-01-01T00:00:00.000Z', access: { restricted: true, allow: ['combo-a', 'combo-b'] } };
      const other = { ...record, id: `other-${suffix}`, key: `other-key-${suffix}` };
      assert.deepEqual(await repository.insert(record), record);
      assert.deepEqual(await repository.findById(record.id), record);
      assert.deepEqual(await repository.findByKey(record.key), record);
      await assert.rejects(repository.insert(record), PersistenceConflictError);
      assert.deepEqual(await repository.insert(other), other);
      await assert.rejects(repository.insert({ ...other, id: `duplicate-key-${suffix}` }), PersistenceConflictError);

      const updated = await repository.update(record.id, {
        name: 'Updated',
        access: { restricted: true, allow: ['combo-c'] },
        id: 'changed-id',
        createdAt: '2026-02-01T00:00:00.000Z',
      });
      assert.deepEqual(updated, {
        id: record.id,
        key: record.key,
        name: 'Updated',
        machineId: record.machineId,
        createdAt: record.createdAt,
        access: { restricted: true, allow: ['combo-c'] },
        isActive: true,
      });
      await assert.rejects(repository.update(record.id, { key: other.key }), PersistenceConflictError);
      await assert.rejects(repository.update(`absent-${suffix}`, { name: 'Absent' }), PersistenceNotFoundError);

      const cleared = await repository.update(record.id, { name: null, machineId: null });
      assert.equal(cleared.name, null);
      assert.equal(cleared.machineId, null);
      assert.equal(cleared.isActive, true);
      assert.equal(await repository.delete(record.id), true);
      assert.equal(await repository.delete(record.id), false);
      assert.equal(await repository.delete(other.id), true);
    });

    it('preserves concurrent disjoint patches atomically', async () => {
      const repository = await createRepository();
      const suffix = randomUUID();
      const record = { id: `concurrent-${suffix}`, key: `concurrent-key-${suffix}`, name: 'Concurrent', machineId: null,
        isActive: true, createdAt: '2026-01-01T00:00:00.000Z', access: { restricted: false, allow: [] } };
      await repository.insert(record);

      await Promise.all([
        repository.update(record.id, { isActive: false }),
        repository.update(record.id, { access: { restricted: true, allow: ['combo-a'] } }),
      ]);

      const after = await repository.findById(record.id);
      assert.equal(after.isActive, false);
      assert.deepEqual(after.access, { restricted: true, allow: ['combo-a'] });
    });
  });
}
