import { assertEphemeralStore, EphemeralStoreConflictError, EphemeralStoreInvalidTtlError } from '../../ports/ephemeralStore.js';

function bind(db, sql, values = []) {
  return db.prepare(sql).bind(...values);
}

function serialize(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new TypeError('EphemeralStore values must be JSON-serializable', { cause: error });
  }
  if (encoded === undefined) throw new TypeError('EphemeralStore values must be JSON-serializable');
  return encoded;
}

function timestamp(now) {
  const value = now();
  if (!Number.isFinite(value)) throw new TypeError('EphemeralStore clock must return a finite timestamp');
  return value;
}

export function createD1EphemeralStore(db, { now = Date.now } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('D1 database binding must provide prepare()');
  }
  if (typeof now !== 'function') throw new TypeError('EphemeralStore now must be a function');

  return assertEphemeralStore({
    async put(namespace, key, value, { ttlMs, ifAbsent = false } = {}) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new EphemeralStoreInvalidTtlError();
      if (typeof namespace !== 'string' || !namespace || typeof key !== 'string' || !key) {
        throw new TypeError('EphemeralStore namespace and key are required');
      }
      const currentTime = timestamp(now);
      const expiresAt = currentTime + ttlMs;
      if (!Number.isFinite(expiresAt)) throw new EphemeralStoreInvalidTtlError();
      const valueJson = serialize(value);
      if (ifAbsent) {
        const result = await bind(db, `
          INSERT INTO ephemeral_store (namespace, key, value_json, expires_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(namespace, key) DO UPDATE SET
            value_json = excluded.value_json,
            expires_at = excluded.expires_at
          WHERE ephemeral_store.expires_at <= ?
        `, [namespace, key, valueJson, expiresAt, currentTime]).run();
        if ((result.meta?.changes ?? 0) === 0) throw new EphemeralStoreConflictError();
        return;
      }
      await bind(db, `
        INSERT INTO ephemeral_store (namespace, key, value_json, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, key) DO UPDATE SET
          value_json = excluded.value_json,
          expires_at = excluded.expires_at
      `, [namespace, key, valueJson, expiresAt]).run();
    },

    async peek(namespace, key) {
      const row = await bind(db,
        'SELECT value_json FROM ephemeral_store WHERE namespace = ? AND key = ? AND expires_at > ?',
        [namespace, key, timestamp(now)],
      ).first();
      return row ? JSON.parse(row.value_json) : null;
    },

    async consume(namespace, key) {
      const row = await bind(db, `
        DELETE FROM ephemeral_store
        WHERE namespace = ? AND key = ? AND expires_at > ?
        RETURNING value_json
      `, [namespace, key, timestamp(now)]).first();
      return row ? JSON.parse(row.value_json) : null;
    },

    async delete(namespace, key) {
      const result = await bind(db,
        'DELETE FROM ephemeral_store WHERE namespace = ? AND key = ?',
        [namespace, key],
      ).run();
      return (result.meta?.changes ?? 0) > 0;
    },
  });
}
