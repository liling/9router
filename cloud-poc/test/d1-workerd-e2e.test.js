import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { apiKeyRepositoryContract } from "../../tests/unit/runtime/persistence/api-key-repository.contract.js";
import { PersistenceConflictError, PersistenceNotFoundError } from "../../open-sse/runtime/ports/persistence/errors.js";

const cloudPocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerEntry = resolve(cloudPocDir, "node_modules/wrangler/bin/wrangler.js");
const testConfig = resolve(cloudPocDir, "test/wrangler.d1-test.toml");
let child;
let logs = "";
let origin;

function dockerlessWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
    cwd: cloudPocDir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

before(async () => {
  dockerlessWrangler(["d1", "migrations", "apply", "lane-b-d1-test", "--local", "--config", testConfig]);
  const portServer = createServer();
  await new Promise((resolveListen) => portServer.listen(0, "127.0.0.1", resolveListen));
  const { port } = portServer.address();
  await new Promise((resolveClose) => portServer.close(resolveClose));

  child = spawn(process.execPath, [wranglerEntry, "dev", "--config", testConfig, "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: cloudPocDir, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8000); });
  origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before readiness:\n${logs}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Wrangler did not become ready:\n${logs}`);
}, { timeout: 60000 });

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

async function call(operation, input = {}) {
  const response = await fetch(`${origin}/probe/d1/api-keys`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, ...input }),
  });
  const body = await response.json();
  if (response.status === 409) throw new PersistenceConflictError(body.message);
  if (response.status === 404) throw new PersistenceNotFoundError(body.message);
  assert.equal(response.ok, true, body?.message || JSON.stringify(body));
  if (operation === "delete") return body.deleted;
  return body;
}

const repository = {
  list: () => call("list"),
  findById: (id) => call("findById", { id }),
  findByKey: (key) => call("findByKey", { key }),
  insert: (record) => call("insert", { record }),
  update: (id, patch) => call("update", { id, patch }),
  delete: (id) => call("delete", { id }),
};

apiKeyRepositoryContract(async () => repository, { describe, it });
