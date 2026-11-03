import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createTemporaryWranglerConfig, removeTemporaryWranglerFile } from "../scripts/wrangler-config.mjs";

const cloudPocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerEntry = resolve(cloudPocDir, "node_modules/wrangler/bin/wrangler.js");
const inheritedConfig = process.env.WORKERS_BUILDS_WRANGLER_CONFIG;
const wranglerConfig = inheritedConfig || createTemporaryWranglerConfig(
  process.env.D1_DATABASE_ID || "00000000-0000-0000-0000-000000000001",
);
after(() => { if (!inheritedConfig) removeTemporaryWranglerFile(wranglerConfig); });

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

test("deployable Worker does not expose API-key operations", async (context) => {
  const migrations = spawnSync(process.execPath, [wranglerEntry, "d1", "migrations", "apply", "9router", "--local", "--config", wranglerConfig], {
    cwd: cloudPocDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(migrations.status, 0, migrations.stderr || migrations.stdout);

  let serverProcess;
  let logs = "";

  const workerPort = await reservePort();
  const inspectorPort = await reservePort();
  const workerOrigin = `http://127.0.0.1:${workerPort}`;
  serverProcess = spawn(process.execPath, [
    wranglerEntry,
    "dev",
    "--config", wranglerConfig,
    "--ip", "127.0.0.1",
    "--port", String(workerPort),
    "--inspector-port", String(inspectorPort),
  ], { cwd: cloudPocDir, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  serverProcess.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12000); });
  serverProcess.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-12000); });
  context.after(async () => {
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      const exited = once(serverProcess, "exit");
      serverProcess.kill("SIGTERM");
      let timeout;
      await Promise.race([exited, new Promise((resolveDelay) => { timeout = setTimeout(resolveDelay, 5000); })]);
      clearTimeout(timeout);
      if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
        const forcedExit = once(serverProcess, "exit");
        serverProcess.kill("SIGKILL");
        await forcedExit;
      }
    }
  });

  let ready = false;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !ready) {
    if (serverProcess.exitCode !== null) throw new Error(`Wrangler exited before readiness:\n${logs}`);
    try {
      const response = await fetch(`${workerOrigin}/health`);
      ready = response.ok;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  assert.equal(ready, true, `Wrangler did not become ready:\n${logs}`);

  const backgroundResponse = await fetch(`${workerOrigin}/probe/background`, { method: "POST" });
  const background = await backgroundResponse.json();
  assert.equal(backgroundResponse.status, 200);
  assert.equal(background.state, "pending", "the response should return before the waitUntil task finishes");
  const pendingResponse = await fetch(`${workerOrigin}/probe/background/${background.id}`);
  assert.deepEqual(await pendingResponse.json(), { id: background.id, state: "pending" });
  const backgroundDeadline = Date.now() + 5000;
  let backgroundState = "pending";
  while (Date.now() < backgroundDeadline && backgroundState === "pending") {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    const stateResponse = await fetch(`${workerOrigin}/probe/background/${background.id}`);
    backgroundState = (await stateResponse.json()).state;
  }
  assert.equal(backgroundState, "finished", "workerd did not finish the waitUntil task after returning the response");

  async function d1ApiKey(operation, input = {}) {
    const response = await fetch(`${workerOrigin}/probe/d1/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, ...input }),
    });
    return { response, body: await response.json() };
  }

  for (const operation of ["list", "findById", "findByKey", "insert", "update", "delete"]) {
    const result = await d1ApiKey(operation, { id: "known-id", key: "known-key", record: { id: "probe", key: "secret" } });
    assert.equal(result.response.status, 404, `${operation} unexpectedly reached the deployable Worker`);
  }

  const isolatedProbes = await Promise.all(["request-a", "request-b"].map(async (key) => {
    const response = await fetch(`${workerOrigin}/probe/d1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value: `value-${key}` }),
    });
    return { status: response.status, ...(await response.json()) };
  }));
  assert.deepEqual(isolatedProbes.map(({ row }) => row), [
    { key: "request-a", value: "value-request-a" },
    { key: "request-b", value: "value-request-b" },
  ]);
  assert.ok(isolatedProbes.every(({ status, executor }) => status === 200 && executor === "openai"));

  const localOnlyResponse = await fetch(`${workerOrigin}/probe/local-only`);
  assert.equal(localOnlyResponse.status, 403);
  assert.deepEqual(await localOnlyResponse.json(), { error: "RuntimeCapabilityError", code: "RUNTIME_CAPABILITY_UNAVAILABLE" });
});

test("concurrent e2e instances reserve distinct worker and inspector ports", async () => {
  const d1TestConfig = resolve(cloudPocDir, "test/wrangler.d1-test.toml");
  const migrations = spawnSync(process.execPath, [wranglerEntry, "d1", "migrations", "apply", "lane-b-d1-test", "--local", "--config", d1TestConfig], {
    cwd: cloudPocDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(migrations.status, 0, migrations.stderr || migrations.stdout);

  const workerPorts = [await reservePort(), await reservePort()];
  const inspectorPorts = [await reservePort(), await reservePort()];
  const persistDirs = [mkdtempSync(join(tmpdir(), "9router-e2e-a-")), mkdtempSync(join(tmpdir(), "9router-e2e-b-"))];
  assert.equal(new Set([...workerPorts, ...inspectorPorts]).size, 4, "reserved ports must all be distinct");

  const instances = workerPorts.map((workerPort, index) => {
    const child = spawn(process.execPath, [
      wranglerEntry,
      "dev",
      "--config", d1TestConfig,
      "--ip", "127.0.0.1",
      "--port", String(workerPort),
      "--inspector-port", String(inspectorPorts[index]),
      "--persist-to", persistDirs[index],
    ], { cwd: cloudPocDir, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const instance = { child, origin: `http://127.0.0.1:${workerPort}`, logs: "" };
    child.stdout.on("data", (chunk) => { instance.logs = `${instance.logs}${chunk}`.slice(-8000); });
    child.stderr.on("data", (chunk) => { instance.logs = `${instance.logs}${chunk}`.slice(-8000); });
    return instance;
  });

  try {
    const deadline = Date.now() + 45000;
    for (const instance of instances) {
      let ready = false;
      while (Date.now() < deadline && !ready) {
        if (instance.child.exitCode !== null) throw new Error(`Wrangler exited before readiness:\n${instance.logs}`);
        try {
          ready = (await fetch(`${instance.origin}/health`)).ok;
        } catch {}
        if (!ready) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      assert.equal(ready, true, `Concurrent Wrangler instance did not become ready:\n${instance.logs}`);
    }
    for (const instance of instances) {
      assert.doesNotMatch(instance.logs, /Address already in use/i, "inspector or worker port collision regressed");
    }
  } finally {
    for (const instance of instances) {
      if (instance.child.exitCode === null && instance.child.signalCode === null) {
        const exited = once(instance.child, "exit");
        instance.child.kill("SIGTERM");
        await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))]);
        if (instance.child.exitCode === null && instance.child.signalCode === null) {
          instance.child.kill("SIGKILL");
          await once(instance.child, "exit");
        }
      }
    }
    for (const persistDir of persistDirs) rmSync(persistDir, { recursive: true, force: true });
  }
});
