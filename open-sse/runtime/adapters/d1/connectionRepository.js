import { assertConnectionRepository } from '../../ports/connectionRepository.js';

const TABLE = 'worker_connections';

export function createD1ConnectionRepository(db) {
  if (!db?.prepare) throw new TypeError('D1 connection repository requires a database');
  return assertConnectionRepository(Object.freeze({
    async getSelectionStrategy({ providerId }) {
      if (typeof providerId !== 'string' || !providerId) throw new TypeError('Invalid provider lookup');
      const row = await db.prepare(
        'SELECT selection_strategy AS strategy FROM worker_provider_settings WHERE provider_id = ?',
      ).bind(providerId).first();
      if (!row) return 'fill_first';
      if (typeof row.strategy !== 'string' || !row.strategy) throw new Error('CONNECTION_SOURCE_INVALID');
      return row.strategy;
    },
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
      const scoped = rows.results.filter((row) => {
        if (excluded.has(row.id)) return false;
        if (row.enabledModels) {
          let enabled;
          try { enabled = JSON.parse(row.enabledModels); } catch { throw new Error('CONNECTION_SOURCE_INVALID'); }
          if (!Array.isArray(enabled)) throw new Error('CONNECTION_SOURCE_INVALID');
          if (enabled.length && !enabled.includes(model)) return false;
        }
        if (typeof row.id !== 'string' || row.providerId !== providerId || typeof row.authType !== 'string') {
          throw new Error('CONNECTION_SOURCE_INVALID');
        }
        return true;
      });
      const candidates = [];
      const unlockTimes = [];
      for (const row of scoped) {
        const cooldowns = [row.cooldownUntil, row.unavailableUntil].filter(Boolean).map(Date.parse);
        if (cooldowns.some((expiry) => !Number.isFinite(expiry))) throw new Error('CONNECTION_SOURCE_INVALID');
        const unlockAt = Math.max(0, ...cooldowns);
        if (unlockAt > now) unlockTimes.push(unlockAt);
        else candidates.push(row);
      }
      return {
        connections: candidates,
        retryAfterAt: scoped.length > 0 && candidates.length === 0 && unlockTimes.length === scoped.length
          ? Math.min(...unlockTimes)
          : null,
      };
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
