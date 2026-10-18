import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import worker from "../src/worker.js";

let upstream;
let upstreamOrigin;
let upstreamAborted = false;

before(async () => {
  upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    if (input.mode === "error") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "mock rate limit" }));
    } else if (input.mode === "abort") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      response.on("close", () => {
        upstreamAborted = !response.writableEnded;
      });
    } else if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: one\n\n");
      setTimeout(() => response.end("data: two\n\n"), 15);
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ echoed: input.prompt }));
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
});

after(async () => new Promise((resolve) => upstream.close(resolve)));

async function invoke(payload, signal) {
  const request = new Request("http://worker.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return worker.fetch(request, { UPSTREAM_ORIGIN: upstreamOrigin });
}

test("forwards JSON requests and responses", async () => {
  const response = await invoke({ prompt: "json" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { echoed: "json" });
});

test("passes multiple SSE chunks without buffering", async () => {
  const response = await invoke({ stream: true });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(await response.text(), "data: one\n\ndata: two\n\n");
});

test("preserves upstream non-2xx status and body", async () => {
  const response = await invoke({ mode: "error" });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "mock rate limit" });
});

test("aborts the upstream fetch when the client aborts", async () => {
  const controller = new AbortController();
  const response = await invoke({ mode: "abort" }, controller.signal);
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await assert.rejects(reader.read());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(upstreamAborted, true);
});
