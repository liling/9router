import { describe, expect, it } from 'vitest';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../../../open-sse/runtime/ports/persistence/errors.js';

export function apiKeyRepositoryContract(createRepository) {
  describe('ApiKeyRepository contract', () => {
    it('provides asynchronous lookups and stable createdAt ordering', async () => {
      const repository = await createRepository();
      const rows = await repository.list();
      expect(rows).toEqual([...rows].sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )));
      expect(await repository.findById('missing-id')).toBeNull();
      expect(await repository.findByKey('missing-key')).toBeNull();
    });

    it('inserts and updates records, reporting duplicate ids or keys as conflicts', async () => {
      const repository = await createRepository();
      const record = { id: 'contract-id', key: 'contract-key', name: 'Contract', machineId: 'machine-contract',
        isActive: true, createdAt: '2026-01-01T00:00:00.000Z', access: { restricted: true, allow: ['combo-a', 'combo-b'] } };
      const other = { ...record, id: 'other-id', key: 'other-key' };
      await expect(repository.insert(record)).resolves.toEqual(record);
      expect(await repository.findById(record.id)).toEqual(record);
      expect(await repository.findByKey(record.key)).toEqual(record);
      await expect(repository.insert(record)).rejects.toBeInstanceOf(PersistenceConflictError);
      await expect(repository.insert(other)).resolves.toEqual(other);
      await expect(repository.insert({ ...other, id: 'duplicate-key-id' })).rejects.toBeInstanceOf(PersistenceConflictError);

      const updated = await repository.update(record.id, {
        name: 'Updated',
        access: { restricted: true, allow: ['combo-c'] },
        id: 'changed-id',
        createdAt: '2026-02-01T00:00:00.000Z',
      });
      expect(updated).toMatchObject({
        id: record.id,
        key: record.key,
        name: 'Updated',
        machineId: record.machineId,
        createdAt: record.createdAt,
        access: { restricted: true, allow: ['combo-c'] },
      });
      await expect(repository.update(record.id, { key: other.key })).rejects.toBeInstanceOf(PersistenceConflictError);
      await expect(repository.update('absent-id', { name: 'Absent' })).rejects.toBeInstanceOf(PersistenceNotFoundError);

      const cleared = await repository.update(record.id, { name: null, machineId: null });
      expect(cleared).toMatchObject({ name: null, machineId: null, isActive: true });
      await expect(repository.delete(record.id)).resolves.toBe(true);
      await expect(repository.delete(record.id)).resolves.toBe(false);
    });

    it('preserves concurrent disjoint patches atomically', async () => {
      const repository = await createRepository();
      const record = { id: 'concurrent-id', key: 'concurrent-key', name: 'Concurrent', machineId: null,
        isActive: true, createdAt: '2026-01-01T00:00:00.000Z', access: { restricted: false, allow: [] } };
      await repository.insert(record);

      await Promise.all([
        repository.update(record.id, { isActive: false }),
        repository.update(record.id, { access: { restricted: true, allow: ['combo-a'] } }),
      ]);

      const after = await repository.findById(record.id);
      expect(after.isActive).toBe(false);
      expect(after.access).toEqual({ restricted: true, allow: ['combo-a'] });
    });
  });
}
