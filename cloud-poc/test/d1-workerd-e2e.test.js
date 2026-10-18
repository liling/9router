import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cloudPocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerEntry = resolve(cloudPocDir, "node_modules/wrangler/bin/wrangler.js");
const testConfig = resolve(cloudPocDir, "test/wrangler.d1-test.toml");

test("test-only Workerd entrypoint verifies the real D1 repository contract", async (context) => {
  const migrations = spawnSync(process.execPath, [wranglerEntry, "d1", "migrations", "apply", "lane-b-d1-test", "--local", "--config", testConfig], {
    cwd: cloudPocDir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(migrations.status, 0, migrations.stderr || migrations.stdout);

  const portServer = createServer();
  await new Promise((resolveListen) => portServer.listen(0, "127.0.0.1", resolveListen));
  const { port } = portServer.address();
  await new Promise((resolveClose) => portServer.close(resolveClose));

  let logs = "";
  const child = spawn(process.execPath, [wranglerEntry, "dev", "--config", testConfig, "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: cloudPocDir, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8000); });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  });

  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !ready) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before readiness:\n${logs}`);
    try { ready = (await fetch(`${origin}/health`)).ok; } catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 250)); }
  }
  assert.equal(ready, true, `Wrangler did not become ready:\n${logs}`);

  async function call(operation, input = {}) {
    const response = await fetch(`${origin}/probe/d1/api-keys`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...input }),
    });
    return { response, body: await response.json() };
  }

  const runId = randomUUID();
  const record = {
    id: `workerd-contract-${runId}`, key: `workerd-contract-key-${runId}`, name: "D1 contract", machineId: null,
    isActive: true, createdAt: "2026-10-18T00:00:00.000Z", access: { restricted: true, allow: ["model-a"] },
  };
  assert.deepEqual((await call("insert", { record })).body, record);
  const duplicate = await call("insert", { record });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.code, "PERSISTENCE_CONFLICT");
  assert.deepEqual((await call("findById", { id: record.id })).body, record);
  assert.deepEqual((await call("findByKey", { key: record.key })).body, record);
  const updated = { ...record, name: "Updated D1 contract", isActive: false };
  assert.deepEqual((await call("update", { id: record.id, patch: { name: updated.name, isActive: false, id: "ignored", createdAt: "ignored" } })).body, updated);
  assert.deepEqual((await call("update", { id: record.id, patch: { name: null, machineId: null } })).body, { ...updated, name: null });
  const reset = await call("update", { id: record.id, patch: { name: updated.name } });
  assert.deepEqual(reset.body, updated);
  assert.deepEqual((await call("list")).body.find((item) => item.id === record.id), updated);
  const missing = await call("update", { id: "missing", patch: { name: "Missing" } });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, "PERSISTENCE_NOT_FOUND");

  const concurrent = { ...record, id: `workerd-concurrent-${runId}`, key: `workerd-concurrent-key-${runId}` };
  await call("insert", { record: concurrent });
  await Promise.all([
    call("update", { id: concurrent.id, patch: { isActive: false } }),
    call("update", { id: concurrent.id, patch: { access: { restricted: true, allow: ["combo-a"] } } }),
  ]);
  const afterConcurrent = (await call("findById", { id: concurrent.id })).body;
  assert.equal(afterConcurrent.isActive, false);
  assert.deepEqual(afterConcurrent.access, { restricted: true, allow: ["combo-a"] });
  assert.deepEqual((await call("delete", { id: record.id })).body, { deleted: true });
  assert.deepEqual((await call("delete", { id: record.id })).body, { deleted: false });
});
