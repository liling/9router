import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { getExecutor, RuntimeCapabilityError } from "../../open-sse/executors/serverless.js";
import worker from "../src/worker.js";

let upstream;
let upstreamOrigin;
let upstreamAborted = false;
let lastUpstreamRequest;

before(async () => {
  upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    lastUpstreamRequest = { url: request.url, body: input };
    if (input.model === "mock-error") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "mock rate limit" }));
    } else if (input.model === "mock-abort") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "abort-1", model: input.model, choices: [{ delta: { content: "first" } }] })}\n\n`);
      response.on("close", () => {
        upstreamAborted = !response.writableEnded;
      });
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
  upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
});

after(async () => new Promise((resolve) => upstream.close(resolve)));

async function invoke(payload, signal, headers = {}) {
  const request = new Request("http://worker.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal,
  });
  return worker.fetch(request, {
    UPSTREAM_ORIGIN: upstreamOrigin,
    DB: { prepare: () => ({ bind() { return this; }, async run() { return { meta: { changes: 1 } }; }, async first() { return null; } }) },
  }, { waitUntil(promise) { promise.catch(() => {}); } });
}

test("translates a Claude JSON request through the production executor and back", async () => {
  const response = await invoke({ model: "mock-model", max_tokens: 32, messages: [{ role: "user", content: "json" }] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, "message");
  assert.equal(body.content[0].text, "json");
  assert.equal(lastUpstreamRequest.url, "/v1/chat/completions");
  assert.deepEqual(lastUpstreamRequest.body.messages, [{ role: "user", content: "json" }]);
  assert.equal(lastUpstreamRequest.body.stream, false);
});

test("translates production executor multi-chunk OpenAI SSE to Claude SSE", async () => {
  const response = await invoke({ model: "mock-model", max_tokens: 32, messages: [{ role: "user", content: "stream" }], stream: true });
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /"text":"one"/);
  assert.match(text, /"text":" two"/);
  assert.equal((text.match(/event: content_block_delta/g) || []).length, 2);
  assert.equal(lastUpstreamRequest.body.messages[0].content, "stream");
  assert.equal(lastUpstreamRequest.body.stream, true);
});

test("preserves upstream non-2xx status and body", async () => {
  const response = await invoke({ model: "mock-error", messages: [{ role: "user", content: "fail" }] });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "mock rate limit" });
});

test("aborts the production executor upstream fetch when the client aborts", async () => {
  const controller = new AbortController();
  const response = await invoke({ model: "mock-abort", messages: [{ role: "user", content: "cancel" }], stream: true }, controller.signal);
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
