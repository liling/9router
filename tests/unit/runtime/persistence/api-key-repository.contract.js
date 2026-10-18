import { describe, expect, it } from 'vitest';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../../../open-sse/runtime/ports/persistence/errors.js';

export function apiKeyRepositoryContract(createRepository) {
  describe('ApiKeyRepository contract', () => {
    it('provides asynchronous lookups and stable createdAt ordering', async () => {
      const repository = await createRepository();
      const rows = await repository.list();
      expect(rows.map((row) => row.createdAt)).toEqual([...rows.map((row) => row.createdAt)].sort());
      expect(await repository.findById(rows[0]?.id ?? 'missing')).toBeDefined();
      expect(await repository.findByKey(rows[0]?.key ?? 'missing')).toBeDefined();
    });

    it('inserts and updates records, reporting duplicate ids or keys as conflicts', async () => {
      const repository = await createRepository();
      const record = { id: 'contract-id', key: 'contract-key', name: 'Contract', machineId: null,
        isActive: true, createdAt: '2026-01-01T00:00:00.000Z', access: { restricted: false, allow: [] } };
      await expect(repository.insert(record)).resolves.toEqual(record);
      await expect(repository.insert(record)).rejects.toBeInstanceOf(PersistenceConflictError);
      await expect(repository.update({ ...record, name: 'Updated' })).resolves.toMatchObject({ name: 'Updated' });
      await expect(repository.update({ ...record, id: 'absent' })).rejects.toBeInstanceOf(PersistenceNotFoundError);
      await expect(repository.delete(record.id)).resolves.toBe(true);
      await expect(repository.delete(record.id)).resolves.toBe(false);
    });
  });
}
