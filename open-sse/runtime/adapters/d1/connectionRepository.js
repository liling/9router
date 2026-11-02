import { assertConnectionRepository } from '../../ports/connectionRepository.js';

const TABLE = 'worker_connections';

export function createD1ConnectionRepository(db) {
  if (!db?.prepare) throw new TypeError('D1 connection repository requires a database');
  return assertConnectionRepository(Object.freeze({
    async listEligibleConnections({ providerId, model, excludedIds = [] }) {
      if (!providerId || !model || !Array.isArray(excludedIds)) throw new TypeError('Invalid connection lookup');
      const rows = await db.prepare(
        `SELECT id, provider_id AS providerId, auth_type AS authType, secret_name AS secretName,
          enabled_models AS enabledModels, priority, is_active AS isActive,
          cooldown_until AS cooldownUntil, unavailable_until AS unavailableUntil
         FROM ${TABLE} WHERE provider_id = ? AND is_active = 1
           AND (unavailable_status IS NULL OR unavailable_status != 'unauthorized' OR unavailable_model != ?)
         ORDER BY priority ASC, id ASC`,
      ).bind(providerId, model).all();
      if (!Array.isArray(rows?.results)) throw new Error('CONNECTION_SOURCE_INVALID');
      const excluded = new Set(excludedIds);
      const now = Date.now();
      return rows.results.filter((row) => {
        if (excluded.has(row.id)) return false;
        if (row.enabledModels) {
          let enabled;
          try { enabled = JSON.parse(row.enabledModels); } catch { throw new Error('CONNECTION_SOURCE_INVALID'); }
          if (!Array.isArray(enabled)) throw new Error('CONNECTION_SOURCE_INVALID');
          if (enabled.length && !enabled.includes(model)) return false;
        }
        for (const field of ['cooldownUntil', 'unavailableUntil']) {
          if (row[field] && Date.parse(row[field]) > now) return false;
          if (row[field] && !Number.isFinite(Date.parse(row[field]))) throw new Error('CONNECTION_SOURCE_INVALID');
        }
        if (typeof row.id !== 'string' || row.providerId !== providerId || typeof row.authType !== 'string') {
          throw new Error('CONNECTION_SOURCE_INVALID');
        }
        return true;
      });
    },
    async markUnavailable({ id, status, model, until }) {
      if (!id || !['unauthorized', 'rate_limited', 'unavailable'].includes(status)) throw new TypeError('Invalid connection status');
      const result = await db.prepare(
        `UPDATE ${TABLE} SET unavailable_status = ?, unavailable_model = ?, unavailable_until = ? WHERE id = ?`,
      ).bind(status, model || null, until || null, id).run();
      if (result?.success === false) throw new Error('CONNECTION_SOURCE_UNAVAILABLE');
    },
  }));
}
