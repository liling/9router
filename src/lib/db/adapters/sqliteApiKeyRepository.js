import {
  PersistenceConflictError,
  PersistenceNotFoundError,
} from "../../../../open-sse/runtime/ports/persistence/errors.js";
import { API_KEY_UPDATE_PATCH_FIELDS } from "../../../../open-sse/runtime/ports/persistence/apiKeyRepository.js";
import { keyAccessFromColumns, keyAccessToColumns } from "../../../shared/utils/keyAccess.js";

function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

function isUniqueConstraint(error) {
  return /CONSTRAINT_(UNIQUE|PRIMARYKEY)/i.test(error?.code || "")
    || /unique constraint failed|primary key constraint failed/i.test(error?.message || "");
}

function mapConflict(error) {
  if (isUniqueConstraint(error)) {
    throw new PersistenceConflictError("API key id or key already exists", { cause: error });
  }
  throw error;
}

export function createSqliteApiKeyRepository(db) {
  return {
    async findById(id) {
      return rowToRecord(db.get("SELECT * FROM apiKeys WHERE id = ?", [id]));
    },

    async findByKey(key) {
      if (!key) return null;
      return rowToRecord(db.get("SELECT * FROM apiKeys WHERE key = ?", [key]));
    },

    async list() {
      return db.all("SELECT * FROM apiKeys ORDER BY createdAt ASC, id ASC").map(rowToRecord);
    },

    async insert(record) {
      const access = keyAccessToColumns(record.access);
      try {
        db.run(
          "INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
          [record.id, record.key, record.name, record.machineId, record.isActive ? 1 : 0,
            record.createdAt, access.accessRestricted, access.accessAllow],
        );
      } catch (error) {
        mapConflict(error);
      }
      return {
        ...record,
        isActive: !!record.isActive,
        access: keyAccessFromColumns(access.accessRestricted, access.accessAllow),
      };
    },

    async update(id, patch) {
      try {
        return db.transaction(() => {
          const current = rowToRecord(db.get("SELECT * FROM apiKeys WHERE id = ?", [id]));
          if (!current) throw new PersistenceNotFoundError(`API key ${id} was not found`);

          const updated = { ...current };
          for (const field of API_KEY_UPDATE_PATCH_FIELDS) {
            if (Object.hasOwn(patch, field)) updated[field] = patch[field];
          }
          const access = keyAccessToColumns(updated.access);
          const result = db.run(
            "UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?",
            [updated.key, updated.name, updated.machineId, updated.isActive ? 1 : 0,
              access.accessRestricted, access.accessAllow, id],
          );
          if (!(result?.changes > 0)) throw new PersistenceNotFoundError(`API key ${id} was not found`);
          return rowToRecord(db.get("SELECT * FROM apiKeys WHERE id = ?", [id]));
        });
      } catch (error) {
        if (error instanceof PersistenceNotFoundError) throw error;
        mapConflict(error);
      }
    },

    async delete(id) {
      const result = db.run("DELETE FROM apiKeys WHERE id = ?", [id]);
      return (result?.changes ?? 0) > 0;
    },
  };
}
