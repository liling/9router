import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { createApiKeyService } from "../../apiKeys/service.js";
import { createSqliteApiKeyRepository } from "../adapters/sqliteApiKeyRepository.js";

const services = new WeakMap();

async function getService() {
  const db = await getAdapter();
  let service = services.get(db);
  if (!service) {
    service = createApiKeyService(createSqliteApiKeyRepository(db), {
      createId: randomUUID,
      generateKey: async (machineId) => {
        const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
        return generateApiKeyWithMachine(machineId);
      },
      now: () => new Date().toISOString(),
    });
    services.set(db, service);
  }
  return service;
}

export async function getApiKeys() { return (await getService()).getApiKeys(); }
export async function getApiKeyById(id) { return (await getService()).getApiKeyById(id); }
export async function getApiKeyByKey(key) { return (await getService()).getApiKeyByKey(key); }
export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  return (await getService()).createApiKey(name, machineId);
}
export async function updateApiKey(id, data) { return (await getService()).updateApiKey(id, data); }
export async function deleteApiKey(id) { return (await getService()).deleteApiKey(id); }
export async function validateApiKey(key) { return (await getService()).validateApiKey(key); }
