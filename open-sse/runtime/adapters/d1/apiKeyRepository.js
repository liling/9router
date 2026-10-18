import { assertApiKeyRepository } from '../../ports/persistence/apiKeyRepository.js';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../ports/persistence/errors.js';

const SELECT_COLUMNS = 'id, key, name, machine_id, is_active, created_at, access_restricted, access_allow';

function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machine_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    access: {
      restricted: row.access_restricted === 1,
      allow: row.access_allow ? JSON.parse(row.access_allow) : [],
    },
  };
}

function isUniqueConstraint(error) {
  return /unique constraint|already exists/i.test(error?.message || '');
}

function throwPersistenceError(error) {
  if (isUniqueConstraint(error)) {
    throw new PersistenceConflictError('API key id or key already exists', { cause: error });
  }
  throw error;
}

function bind(db, sql, values = []) {
  return db.prepare(sql).bind(...values);
}

export function createD1ApiKeyRepository(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('D1 database binding must provide prepare()');
  }

  return assertApiKeyRepository({
    async findById(id) {
      return rowToRecord(await bind(db, `SELECT ${SELECT_COLUMNS} FROM api_keys WHERE id = ?`, [id]).first());
    },

    async findByKey(key) {
      if (!key) return null;
      return rowToRecord(await bind(db, `SELECT ${SELECT_COLUMNS} FROM api_keys WHERE key = ?`, [key]).first());
    },

    async list() {
      const result = await bind(db, `SELECT ${SELECT_COLUMNS} FROM api_keys ORDER BY created_at ASC, id ASC`).all();
      return (result.results || []).map(rowToRecord);
    },

    async insert(record) {
      try {
        await bind(db,
          `INSERT INTO api_keys (${SELECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.key, record.name, record.machineId, record.isActive ? 1 : 0,
            record.createdAt, record.access.restricted ? 1 : 0, JSON.stringify(record.access.allow || [])],
        ).run();
      } catch (error) {
        throwPersistenceError(error);
      }
      return record;
    },

    async update(record) {
      try {
        const result = await bind(db,
          `UPDATE api_keys SET key = ?, name = ?, machine_id = ?, is_active = ?, access_restricted = ?, access_allow = ? WHERE id = ?`,
          [record.key, record.name, record.machineId, record.isActive ? 1 : 0,
            record.access.restricted ? 1 : 0, JSON.stringify(record.access.allow || []), record.id],
        ).run();
        if ((result.meta?.changes || 0) === 0) {
          const existing = await bind(db, 'SELECT id FROM api_keys WHERE id = ?', [record.id]).first();
          if (!existing) throw new PersistenceNotFoundError(`API key ${record.id} was not found`);
        }
      } catch (error) {
        if (error instanceof PersistenceNotFoundError) throw error;
        throwPersistenceError(error);
      }
      return record;
    },

    async delete(id) {
      const result = await bind(db, 'DELETE FROM api_keys WHERE id = ?', [id]).run();
      return (result.meta?.changes || 0) > 0;
    },
  });
}
