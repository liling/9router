import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cloudPocDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerEntry = resolve(cloudPocDir, "node_modules/wrangler/bin/wrangler.js");

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

test("deployable Worker does not expose API-key operations", async (context) => {
  const migrations = spawnSync(process.execPath, [wranglerEntry, "d1", "migrations", "apply", "lane-b", "--local"], {
    cwd: cloudPocDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(migrations.status, 0, migrations.stderr || migrations.stdout);

  let resolveUpstreamAbort;
  const upstreamAbort = new Promise((resolve) => { resolveUpstreamAbort = resolve; });
  let serverProcess;
  let upstream;
  let logs = "";

  upstream = createServer(async (request, response) => {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const input = JSON.parse(rawBody);

    if (input.model === "mock-error") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "mock rate limit" } }));
      return;
    }
    if (input.model === "mock-abort") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "abort-1", model: input.model, choices: [{ delta: { content: "first" } }] })}\n\n`);
      response.on("close", () => resolveUpstreamAbort());
      return;
    }
    if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const text of ["one", " two"]) {
        response.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: { content: text } }] })}\n\n`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      response.end(`data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "chatcmpl-mock",
      model: input.model,
      choices: [{ message: { role: "assistant", content: input.messages?.at(-1)?.content || "mock json" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
  await new Promise((resolveListen) => upstream.listen(0, "127.0.0.1", resolveListen));

  const workerPort = await reservePort();
  const upstreamPort = upstream.address().port;
  const workerOrigin = `http://127.0.0.1:${workerPort}`;
  serverProcess = spawn(process.execPath, [
    wranglerEntry,
    "dev",
    "--ip", "127.0.0.1",
    "--port", String(workerPort),
    "--var", `UPSTREAM_ORIGIN:http://127.0.0.1:${upstreamPort}`,
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
    upstream.closeAllConnections();
    await new Promise((resolveClose) => upstream.close(resolveClose));
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

  const jsonResponse = await fetch(`${workerOrigin}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", max_tokens: 32, messages: [{ role: "user", content: "workerd json" }] }),
  });
  assert.equal(jsonResponse.status, 200);
  assert.equal((await jsonResponse.json()).content[0].text, "workerd json");

  const sseResponse = await fetch(`${workerOrigin}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", max_tokens: 32, messages: [{ role: "user", content: "stream" }], stream: true }),
  });
  const sseBody = await sseResponse.text();
  assert.equal(sseResponse.status, 200);
  assert.match(sseBody, /"text":"one"/);
  assert.match(sseBody, /"text":" two"/);

  const errorResponse = await fetch(`${workerOrigin}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-error", messages: [{ role: "user", content: "fail" }] }),
  });
  assert.equal(errorResponse.status, 429);
  assert.deepEqual(await errorResponse.json(), { error: { message: "mock rate limit" } });

  await new Promise((resolveRequest, rejectRequest) => {
    let cancelled = false;
    const clientRequest = httpRequest(`${workerOrigin}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }, (response) => {
      response.once("data", () => {
        cancelled = true;
        clientRequest.destroy();
        resolveRequest();
      });
      response.on("error", () => {});
    });
    clientRequest.on("error", (error) => {
      if (!cancelled) rejectRequest(error);
    });
    clientRequest.end(JSON.stringify({ model: "mock-abort", messages: [{ role: "user", content: "cancel" }], stream: true }));
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("upstream was not cancelled")), 5000);
    upstreamAbort.then(() => {
      clearTimeout(timeout);
      resolve();
    }, reject);
  });

  const localOnlyResponse = await fetch(`${workerOrigin}/probe/local-only`);
  assert.equal(localOnlyResponse.status, 403);
  assert.deepEqual(await localOnlyResponse.json(), { error: "RuntimeCapabilityError", code: "RUNTIME_CAPABILITY_UNAVAILABLE" });
});
