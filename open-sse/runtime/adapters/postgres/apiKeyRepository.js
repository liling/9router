import { Pool } from 'pg';
import { assertApiKeyRepository } from '../../ports/persistence/apiKeyRepository.js';
import { PersistenceConflictError, PersistenceNotFoundError } from '../../ports/persistence/errors.js';

const COLUMNS = 'id, key, name, machine_id, is_active, created_at, access_restricted, access_allow';

function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machine_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    access: {
      restricted: row.access_restricted,
      allow: row.access_allow,
    },
  };
}

function mapWriteError(error) {
  if (error?.code === '23505') {
    throw new PersistenceConflictError('API key id or key already exists', { cause: error });
  }
  throw error;
}

export function createPostgresApiKeyRepository(poolOptions) {
  if (!poolOptions || (!poolOptions.connectionString && !poolOptions.host)) {
    throw new TypeError('PostgreSQL pool options must include connectionString or host');
  }

  const pool = new Pool({ max: 2, ...poolOptions });
  const repository = {
    async findById(id) {
      const result = await pool.query(`SELECT ${COLUMNS} FROM api_keys WHERE id = $1`, [id]);
      return rowToRecord(result.rows[0]);
    },

    async findByKey(key) {
      if (!key) return null;
      const result = await pool.query(`SELECT ${COLUMNS} FROM api_keys WHERE key = $1`, [key]);
      return rowToRecord(result.rows[0]);
    },

    async list() {
      const result = await pool.query(`SELECT ${COLUMNS} FROM api_keys ORDER BY created_at ASC, id ASC`);
      return result.rows.map(rowToRecord);
    },

    async insert(record) {
      try {
        const result = await pool.query(
          `INSERT INTO api_keys (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING ${COLUMNS}`,
          [record.id, record.key, record.name, record.machineId, record.isActive,
            record.createdAt, record.access.restricted, JSON.stringify(record.access.allow || [])],
        );
        return rowToRecord(result.rows[0]);
      } catch (error) {
        mapWriteError(error);
      }
    },

    async update(id, patch) {
      const assignments = [];
      const values = [];
      const columns = {
        key: 'key',
        name: 'name',
        machineId: 'machine_id',
        isActive: 'is_active',
      };
      for (const [field, column] of Object.entries(columns)) {
        if (!Object.hasOwn(patch, field)) continue;
        values.push(patch[field]);
        assignments.push(`${column} = $${values.length}`);
      }
      if (Object.hasOwn(patch, 'access')) {
        values.push(patch.access.restricted, JSON.stringify(patch.access.allow || []));
        assignments.push(`access_restricted = $${values.length - 1}`, `access_allow = $${values.length}::jsonb`);
      }
      try {
        const result = assignments.length
          ? await pool.query(
            `UPDATE api_keys SET ${assignments.join(', ')} WHERE id = $${values.length + 1} RETURNING ${COLUMNS}`,
            [...values, id],
          )
          : await pool.query(`SELECT ${COLUMNS} FROM api_keys WHERE id = $1`, [id]);
        if (!result.rows[0]) throw new PersistenceNotFoundError(`API key ${id} was not found`);
        return rowToRecord(result.rows[0]);
      } catch (error) {
        if (error instanceof PersistenceNotFoundError) throw error;
        mapWriteError(error);
      }
    },

    async delete(id) {
      const result = await pool.query('DELETE FROM api_keys WHERE id = $1 RETURNING id', [id]);
      return result.rowCount > 0;
    },

    async close() {
      await pool.end();
    },
  };

  return assertApiKeyRepository(repository);
}
