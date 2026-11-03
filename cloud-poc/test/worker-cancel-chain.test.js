import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { registerExecutorFetch } from "../../open-sse/utils/executorFetch.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import worker from "../src/worker.js";

const ORIGINAL_FETCH = globalThis.fetch;
const REGISTRY_HOSTS = new Set([new URL(PROVIDERS.openai.baseUrl).hostname, new URL(PROVIDERS.anthropic.baseUrl).hostname]);

let upstream;
let upstreamPort;
let observation;

function observeUpstream() {
  let resolveClosed;
  observation = {
    requestCount: 0,
    closed: new Promise((resolve) => { resolveClosed = resolve; }),
    resolveClosed: () => resolveClosed(),
  };
  return observation;
}

before(async () => {
  observeUpstream();
  upstream = createServer(async (request, response) => {
    for await (const _chunk of request) { }
    const requestObservation = observation;
    requestObservation.requestCount += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "cancel-chain", model: "mock-abort", choices: [{ delta: { content: "ready" } }] })}\n\n`);
    response.on("close", () => {
      if (!response.writableEnded) requestObservation.resolveClosed();
    });
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
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

function invoke(signal) {
  return worker.fetch(new Request("http://worker.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "openai", model: "mock-abort", messages: [{ role: "user", content: "cancel" }], stream: true }),
    signal,
  }), {
    WORKER_CREDENTIAL: JSON.stringify({ version: 1, authType: "api_key", apiKey: crypto.randomUUID() }),
    DB: { prepare: () => ({ bind() { return this; }, async all() { return { results: [{ id: "connection", providerId: "openai", authType: "api_key", secretName: "WORKER_CREDENTIAL", enabledModels: "[]", priority: 0, isActive: 1 }] }; }, async run() { return { meta: { changes: 1 } }; }, async first() { return null; } }) },
  }, { waitUntil(promise) { promise.catch(() => {}); } });
}

async function assertUpstreamClosedWithinTwoSeconds(requestObservation) {
  let timeout;
  const didClose = await Promise.race([
    requestObservation.closed.then(() => true),
    new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 2000); }),
  ]);
  clearTimeout(timeout);
  assert.equal(didClose, true, "upstream socket did not close within 2 seconds");
}

test("reader.cancel() closes the real upstream socket", async () => {
  const requestObservation = observeUpstream();
  const response = await invoke();
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  assert.ok(firstChunk.value?.byteLength, "expected an initial stream chunk");

  await reader.cancel();
  await assertUpstreamClosedWithinTwoSeconds(requestObservation);
});

test("a pre-aborted request signal rejects with AbortError before upstream fetch", async () => {
  const requestObservation = observeUpstream();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(invoke(controller.signal), { name: "AbortError" });
  assert.equal(requestObservation.requestCount, 0, "pre-aborted request reached the upstream server");
});

test("aborting the request after the response starts closes the upstream socket", async () => {
  const requestObservation = observeUpstream();
  const controller = new AbortController();
  const response = await invoke(controller.signal);
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  assert.ok(firstChunk.value?.byteLength, "expected an initial stream chunk");

  controller.abort();
  await assertUpstreamClosedWithinTwoSeconds(requestObservation);
});
