import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { getExecutor, RuntimeCapabilityError } from "../../open-sse/executors/serverless.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { registerExecutorFetch } from "../../open-sse/utils/executorFetch.js";
import worker from "../src/worker.js";

// The Worker executes against the registry URL (https://api.openai.com/v1/chat/completions);
// the http-fetch port is redirected to this offline fixture so no loopback origin is configured.
const ORIGINAL_FETCH = globalThis.fetch;
const REGISTRY_HOSTS = new Set([new URL(PROVIDERS.openai.baseUrl).hostname, new URL(PROVIDERS.anthropic.baseUrl).hostname]);
const CONNECTION_SECRET_NAMES = ["WORKER_CREDENTIAL_0", "WORKER_CREDENTIAL_1"];

let upstream;
let upstreamPort;
let upstreamAborted = false;
let lastUpstreamRequest;
const observedAuthorizations = new Map();
let unauthorizedAttempts = 0;
let currentCredentialValues = [];

before(async () => {
  upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    lastUpstreamRequest = { url: request.url, body: input };
    observedAuthorizations.set(input.model, request.headers.authorization);
    if (input.model === "mock-unauthorized-all" || (input.model === "mock-unauthorized" && unauthorizedAttempts++ === 0)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
    } else if (input.model === "mock-error") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "mock rate limit" }));
    } else if (input.model === "mock-abort") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "abort-1", model: input.model, choices: [{ delta: { content: "first" } }] })}\n\n`);
      response.on("close", () => {
        upstreamAborted = !response.writableEnded;
      });
    } else if (input.model === "mock-forced-sse") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        `data: ${JSON.stringify({ id: "forced-sse", model: input.model, choices: [{ delta: { role: "assistant", content: "forced" } }] })}\n\n`,
        `data: ${JSON.stringify({ id: "forced-sse", model: input.model, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""));
    } else if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: { content: "one" } }] })}\n\n`);
      setTimeout(() => response.end([
        `data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: { content: " two" } }] })}\n\n`,
        `data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join("")), 15);
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "chatcmpl-mock",
        model: input.model,
        choices: [{ message: { role: "assistant", content: input.messages?.at(-1)?.content || "mock json" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = upstream.address().port;
  registerExecutorFetch({ fetch(input, init) {
    const target = new URL(typeof input === "string" ? input : input.url);
    return REGISTRY_HOSTS.has(target.hostname)
      ? ORIGINAL_FETCH(`http://127.0.0.1:${upstreamPort}${target.pathname}${target.search}`, init)
      : ORIGINAL_FETCH(input, init);
  } });
});

after(async () => {
  registerExecutorFetch({ fetch: ORIGINAL_FETCH });
  await new Promise((resolve) => upstream.close(resolve));
});

async function invoke(payload, signal, headers = {}, connectionCount = 1, options = {}) {
  const request = new Request("http://worker.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal,
  });
  const connections = Array.from({ length: connectionCount }, (_, index) => ({
    id: `connection-${index}`,
    providerId: "openai",
    authType: "api_key",
    secretName: CONNECTION_SECRET_NAMES[index],
    enabledModels: "[]",
    priority: index,
    isActive: 1,
    cooldownUntil: options.cooldownUntil || null,
  }));
  currentCredentialValues = connections.map(() => crypto.randomUUID());
  const secrets = Object.fromEntries(connections.map((connection, index) => [
    connection.secretName,
    JSON.stringify({ version: 1, authType: "api_key", apiKey: currentCredentialValues[index] }),
  ]));
  options.onCredentials?.([...currentCredentialValues]);
  headers = { "x-request-id": `request-${Math.random().toString(36).slice(2)}`, ...headers };
  return worker.fetch(request, {
    ...secrets,
    DB: { prepare(sql) { return { bind() { return this; }, async all() { return { results: connections }; }, async run() { return { meta: { changes: 1 } }; }, async first() { return sql.includes("worker_provider_settings") && options.strategy ? { strategy: options.strategy } : null; } }; } },
  }, { waitUntil(promise) { promise.catch(() => {}); } });
}

test("translates a Claude JSON request through the production executor and back", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-model", system: "test", max_tokens: 32, messages: [{ role: "user", content: "json" }] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, "message");
  assert.equal(body.content[0].text, "json");
  for (const value of currentCredentialValues) assert.equal(JSON.stringify(body).includes(value), false);
  assert.equal(JSON.stringify(body).includes(CONNECTION_SECRET_NAMES[0]), false);
  assert.equal(lastUpstreamRequest.url, "/v1/chat/completions");
  assert.deepEqual(lastUpstreamRequest.body.messages, [{ role: "system", content: "test" }, { role: "user", content: "json" }]);
  assert.equal(lastUpstreamRequest.body.providerId, undefined);
  assert.equal(lastUpstreamRequest.body.stream, false);
});

test("maps an upstream SSE response to JSON through the production non-streaming handler", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-forced-sse", system: "test", messages: [{ role: "user", content: "forced" }] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, "message");
  assert.equal(body.content[0].text, "forced");
  assert.equal(lastUpstreamRequest.body.stream, false);
});

test("translates production executor multi-chunk OpenAI SSE to Claude SSE", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-model", system: "test", max_tokens: 32, messages: [{ role: "user", content: "stream" }], stream: true });
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /"text":"one"/);
  assert.match(text, /"text":" two"/);
  assert.equal((text.match(/event: content_block_delta/g) || []).length, 2);
  assert.equal(lastUpstreamRequest.body.messages[1].content, "stream");
  assert.equal(lastUpstreamRequest.body.stream, true);
});

test("preserves upstream non-2xx status and body", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-error", messages: [{ role: "user", content: "fail" }] });
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error.code, "rate_limit_exceeded");
  assert.equal(body.error.type, "rate_limit_error");
  assert.match(body.error.message, /429/);
  assert.doesNotMatch(body.error.message, /WORKER_CREDENTIAL|connection-/);
  for (const value of currentCredentialValues) assert.equal(body.error.message.includes(value), false);
});

test("retries unauthorized credentials only against another same-provider connection", async () => {
  unauthorizedAttempts = 0;
  const response = await invoke({ providerId: "openai", model: "mock-unauthorized", messages: [{ role: "user", content: "retry" }] }, undefined, {}, 2);
  assert.equal(response.status, 200);
  assert.equal(unauthorizedAttempts, 2);
});

test("returns a sanitized failure when no connection is eligible", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-model", messages: [] }, undefined, {}, 0);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "credential_unavailable");
  assert.equal(typeof body.requestId, "string");
});

test("does not return upstream authorization details when all connections fail", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-unauthorized-all", messages: [] }, undefined, {}, 2);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /credential_unavailable/);
  assert.doesNotMatch(body, /unauthorized|WORKER_CREDENTIAL/);
});

test("rejects a configured non-fill-first strategy without looking up secrets", async () => {
  lastUpstreamRequest = null;
  const response = await invoke({ providerId: "openai", model: "mock-model", messages: [] }, undefined, {}, 1, { strategy: "round_robin" });
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["error", "requestId"]);
  assert.equal(lastUpstreamRequest, null);
});

test("rejects unsupported provider ids before reading connection credentials", async () => {
  let connectionReads = 0;
  const request = new Request("http://worker.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "google", model: "mock-model", messages: [] }),
  });
  const response = await worker.fetch(request, {
    DB: { prepare() { connectionReads += 1; throw new Error("connection read must not occur"); } },
  }, { waitUntil() {} });
  assert.equal(response.status, 400);
  const rejection = await response.json();
  assert.equal(rejection.error, "credential_unsupported");
  assert.equal(typeof rejection.requestId, "string");
  assert.equal(connectionReads, 0);
});

test("concurrent requests keep resolved credentials isolated", async () => {
  let firstCredentials;
  let secondCredentials;
  const [first, second] = await Promise.all([
    invoke({ providerId: "openai", model: "isolated-first", messages: [] }, undefined, {}, 1, { onCredentials(values) { firstCredentials = values; } }),
    invoke({ providerId: "openai", model: "isolated-second", messages: [] }, undefined, {}, 1, { onCredentials(values) { secondCredentials = values; } }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(firstCredentials[0], secondCredentials[0]);
  assert.equal(observedAuthorizations.get("isolated-first"), `Bearer ${firstCredentials[0]}`);
  assert.equal(observedAuthorizations.get("isolated-second"), `Bearer ${secondCredentials[0]}`);
});

test("returns only a sanitized Retry-After when every candidate is cooldown-locked", async () => {
  const expiry = new Date(Date.now() + 30_000).toISOString();
  const response = await invoke({ providerId: "openai", model: "mock-model", messages: [] }, undefined, {}, 2, { cooldownUntil: expiry });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "credential_unavailable");
  assert.deepEqual(Object.keys(body).sort(), ["error", "requestId"]);
  const retryAfter = Number(response.headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 30);
  assert.notEqual(response.headers.get("retry-after"), expiry);
  assert.doesNotMatch(response.headers.get("retry-after"), /connection|credential|WORKER_CREDENTIAL/i);
});

test("aborts the production executor upstream fetch when the client aborts", async () => {
  const controller = new AbortController();
  const response = await invoke({ providerId: "openai", model: "mock-abort", messages: [{ role: "user", content: "cancel" }], stream: true }, controller.signal);
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  assert.ok(firstChunk.value?.length);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(upstreamAborted, true);
});

test("serverless registry explicitly rejects Local-only executors", () => {
  assert.throws(() => getExecutor("devin-cli"), RuntimeCapabilityError);
});

test("serverless registry executes only the production DefaultExecutor", () => {
  assert.equal(getExecutor("openai").constructor.name, "DefaultExecutor");
});

test("remote validation probes are disabled unless validation mode is explicit", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/probe/validation/missing-binding"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 404);
});

test("validation probes reject requests without the per-run credential", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/probe/validation/missing-binding"),
    { VALIDATION_MODE: "true", VALIDATION_PROBE_TOKEN: "expected-token" },
    { waitUntil() {} },
  );
  assert.equal(response.status, 404);
});

test("validation composition fails closed when D1 is missing", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/probe/validation/missing-binding", {
      headers: { "x-validation-token": "test-validation-token" },
    }),
    { VALIDATION_MODE: "true", VALIDATION_PROBE_TOKEN: "test-validation-token" },
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { failClosed: true });
});

test("validation persistence probe uses the composed repository and cleans up its synthetic record", async () => {
  const records = new Map();
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...nextValues) { values = nextValues; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO api_keys")) {
            const [id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow] = values;
            records.set(key, { id, key, name, machine_id: machineId, is_active: isActive, created_at: createdAt,
              access_restricted: accessRestricted, access_allow: accessAllow });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM api_keys")) return { meta: { changes: records.delete(values[0]) ? 1 : 0 } };
          throw new Error("Unexpected D1 write in repository probe test");
        },
        async first() {
          if (sql.includes("FROM api_keys WHERE key = ?")) return records.get(values[0]) || null;
          throw new Error("Unexpected D1 read in repository probe test");
        },
      };
    },
  };
  const env = { VALIDATION_MODE: "true", VALIDATION_PROBE_TOKEN: "test-validation-token", DB: db };
  const executionContext = { waitUntil() {} };
  const key = `validation:${crypto.randomUUID()}`;
  const headers = { "x-validation-token": env.VALIDATION_PROBE_TOKEN };
  const write = await worker.fetch(new Request("https://worker.test/probe/validation/persistence", {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ key }),
  }), env, executionContext);
  assert.deepEqual(await write.json(), { written: true });

  const read = await worker.fetch(new Request(`https://worker.test/probe/validation/persistence/${encodeURIComponent(key)}`, { headers }), env, executionContext);
  const body = await read.json();
  assert.equal(read.status, 200);
  assert.equal(body.record.key, key);
  assert.equal(body.deleted, true);
  assert.equal(records.size, 0);

  const missing = await worker.fetch(new Request(`https://worker.test/probe/validation/persistence/${encodeURIComponent(key)}`, { headers }), env, executionContext);
  assert.equal(missing.status, 404);
});

test("validation cleanup removes every synthetic D1 row by exact run suffix", async () => {
  const suffix = `run-${crypto.randomUUID()}`;
  const apiKeys = new Set([`validation:${suffix}`]);
  const ephemeral = new Set([
    `validation-a-${suffix}/${suffix}`,
    `validation-b-${suffix}/${suffix}`,
    ...Array.from({ length: 12 }, (_, index) => `validation:request-context:${suffix}-${index}/context`),
  ]);
  const backgrounds = new Set([`validation:${suffix}`]);
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...nextValues) { values = nextValues; return this; },
        async run() {
          if (sql.startsWith("DELETE FROM api_keys")) return { meta: { changes: apiKeys.delete(values[0]) ? 1 : 0 } };
          if (sql.startsWith("DELETE FROM ephemeral_store")) return { meta: { changes: ephemeral.delete(`${values[0]}/${values[1]}`) ? 1 : 0 } };
          if (sql.startsWith("DELETE FROM validation_background")) return { meta: { changes: backgrounds.delete(values[0]) ? 1 : 0 } };
          throw new Error("Unexpected cleanup SQL");
        },
        async first() { return null; },
      };
    },
  };
  const env = { VALIDATION_MODE: "true", VALIDATION_PROBE_TOKEN: "test-validation-token", DB: db };
  const response = await worker.fetch(new Request("https://worker.test/probe/validation/cleanup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-validation-token": env.VALIDATION_PROBE_TOKEN },
    body: JSON.stringify({ suffix }),
  }), env, { waitUntil() {} });
  const { outcomes } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(outcomes.api_keys, "deleted");
  assert.equal(outcomes.ephemeral_probe, "deleted");
  assert.equal(outcomes.ephemeral_isolation, "deleted");
  assert.equal(outcomes.ephemeral_context, "cleaned:12");
  assert.equal(outcomes.validation_background, "cleaned:1");
  assert.equal(apiKeys.size + ephemeral.size + backgrounds.size, 0);
});

test("does not expose raw credential material in successful streams", async () => {
  const response = await invoke({ providerId: "openai", model: "mock-model", system: "test", messages: [{ role: "user", content: "stream" }], stream: true });
  assert.equal(response.status, 200);
  const text = await response.text();
  for (const value of currentCredentialValues) assert.doesNotMatch(text, new RegExp(value));
  assert.doesNotMatch(text, /WORKER_CREDENTIAL_/);
});
