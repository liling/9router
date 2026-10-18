import { PersistenceNotFoundError } from "../../../open-sse/runtime/ports/persistence/errors.js";

export function createApiKeyService(repository, { createId, generateKey, now }) {
  return {
    getApiKeys: () => repository.list(),
    getApiKeyById: (id) => repository.findById(id),
    getApiKeyByKey: (key) => repository.findByKey(key),

    async createApiKey(name, machineId) {
      if (!machineId) throw new Error("machineId is required");
      const { key } = await generateKey(machineId);
      return repository.insert({
        id: createId(),
        key,
        name,
        machineId,
        isActive: true,
        createdAt: now(),
        access: { restricted: false, allow: [] },
      });
    },

    async updateApiKey(id, data) {
      const existing = await repository.findById(id);
      if (!existing) return null;
      try {
        return await repository.update({ ...existing, ...data, id });
      } catch (error) {
        if (error instanceof PersistenceNotFoundError) return null;
        throw error;
      }
    },

    deleteApiKey: (id) => repository.delete(id),

    async validateApiKey(key) {
      const record = await repository.findByKey(key);
      return !!record?.isActive;
    },
  };
}
