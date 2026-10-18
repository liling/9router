import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiKeyRepositoryContract } from "./api-key-repository.contract.js";
import { createApiKeyService } from "../../../../src/lib/apiKeys/service.js";
import { createNodeSqliteAdapter } from "../../../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { createSqliteApiKeyRepository } from "../../../../src/lib/db/adapters/sqliteApiKeyRepository.js";
import { TABLES, buildCreateTableSql } from "../../../../src/lib/db/schema.js";
import {
  PersistenceConflictError,
} from "../../../../open-sse/runtime/ports/persistence/errors.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const nodeHasBuiltinSqlite = (() => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 5);
})();
const bunAvailable = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let tempDir;
let database;
let repository;
let appDatabase;
let apiKeysService;
let originalDataDir;

if (nodeHasBuiltinSqlite) {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-sqlite-"));
    database = await createNodeSqliteAdapter(path.join(tempDir, "api-keys.sqlite"));
    database.exec(buildCreateTableSql("apiKeys", TABLES.apiKeys));
    for (const index of TABLES.apiKeys.indexes) database.exec(index);
    repository = createSqliteApiKeyRepository(database);

    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = path.join(tempDir, "application-data");
    vi.resetModules();
    const { getAdapter } = await import("../../../../src/lib/db/driver.js");
    appDatabase = await getAdapter();
    apiKeysService = await import("../../../../src/lib/db/repos/apiKeysRepo.js");
  });

  afterAll(() => {
    appDatabase?.close();
    database?.close();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  apiKeyRepositoryContract(async () => repository);

  describe("API-key application service over real Node SQLite", () => {
    it("orders equal creation timestamps by id for deterministic listings", async () => {
      const row = (id) => ({
        id,
        key: `order-key-${id}`,
        name: id,
        machineId: null,
        isActive: true,
        createdAt: "2026-10-18T00:00:00.000Z",
        access: { restricted: false, allow: [] },
      });
      await repository.insert(row("order-z"));
      await repository.insert(row("order-a"));
      const matching = (await repository.list()).filter((record) => record.id.startsWith("order-"));
      expect(matching.map((record) => record.id)).toEqual(["order-a", "order-z"]);
    });

    it("preserves create, access metadata, update, validation, and delete behavior", async () => {
      const service = createApiKeyService(repository, {
        createId: () => "service-id",
        generateKey: async (machineId) => ({ key: `service-key-${machineId}` }),
        now: () => "2026-10-18T00:00:00.000Z",
      });

      const created = await service.createApiKey("service", "machine-1");
      expect(created).toMatchObject({
        id: "service-id",
        key: "service-key-machine-1",
        isActive: true,
        access: { restricted: false, allow: [] },
      });
      expect(await service.getApiKeyByKey(created.key)).toEqual(created);
      expect(await service.validateApiKey(created.key)).toBe(true);

      const updated = await service.updateApiKey(created.id, {
        isActive: false,
        access: { restricted: true, allow: ["openai/gpt-test"] },
      });
      expect(updated).toMatchObject({ isActive: false, access: { restricted: true, allow: ["openai/gpt-test"] } });
      expect(await service.validateApiKey(created.key)).toBe(false);
      expect(await service.deleteApiKey(created.id)).toBe(true);
      expect(await service.getApiKeyById(created.id)).toBeNull();
    });

    it("maps SQLite uniqueness violations to the shared persistence conflict error", async () => {
      const record = {
        id: "conflict-id",
        key: "conflict-key",
        name: "Conflict",
        machineId: null,
        isActive: true,
        createdAt: "2026-10-18T00:00:00.000Z",
        access: { restricted: false, allow: [] },
      };
      await repository.insert(record);
      await expect(repository.insert({ ...record, id: "another-id" })).rejects.toBeInstanceOf(PersistenceConflictError);
    });

    it("runs the production API-key repository service on the local Node SQLite driver", async () => {
      expect(appDatabase.driver).toMatch(/sqlite/);
      const record = await apiKeysService.createApiKey("node-local", "machine-node");
      expect(await apiKeysService.getApiKeyByKey(record.key)).toMatchObject({ id: record.id, name: "node-local" });
      expect(await apiKeysService.validateApiKey(record.key)).toBe(true);
      expect((await apiKeysService.updateApiKey(record.id, { isActive: false })).isActive).toBe(false);
      expect(await apiKeysService.validateApiKey(record.key)).toBe(false);
      expect(await apiKeysService.deleteApiKey(record.id)).toBe(true);
    });
  });
} else {
  describe.skip("Node SQLite API-key repository", () => {
    it("requires node:sqlite available in Node 22.5 or newer", () => {});
  });
}

describe.skipIf(!bunAvailable)("API-key SQLite adapter under Bun", () => {
  it("uses the same async service contract with bun:sqlite", () => {
    const script = `
      import assert from "node:assert/strict";
      import { mkdtempSync, rmSync } from "node:fs";
      import os from "node:os";
      import path from "node:path";
      const dir = mkdtempSync(path.join(os.tmpdir(), "9router-bun-api-key-"));
      process.env.DATA_DIR = dir;
      const { getAdapter } = await import("./src/lib/db/driver.js");
      const db = await getAdapter();
      try {
        assert.equal(db.driver, "bun:sqlite");
        const service = await import("./src/lib/db/repos/apiKeysRepo.js");
        const record = await service.createApiKey("bun", "machine-bun");
        assert.equal((await service.getApiKeyByKey(record.key)).id, record.id);
        assert.equal(await service.validateApiKey(record.key), true);
        assert.equal((await service.updateApiKey(record.id, { isActive: false })).isActive, false);
        assert.equal(await service.validateApiKey(record.key), false);
        assert.equal(await service.deleteApiKey(record.id), true);
        console.log("bun-sqlite-api-key-ok");
      } finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
      }
    `;
    const output = execFileSync("bun", ["--eval", script], { cwd: repoRoot, encoding: "utf8" });
    expect(output).toContain("bun-sqlite-api-key-ok");
  });
});
