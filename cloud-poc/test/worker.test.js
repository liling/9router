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
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "first" } }] })}\n\n`);
      response.on("close", () => {
        upstreamAborted = !response.writableEnded;
      });
    } else if (request.url === "/v1/messages") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "message_start", message: { id: "msg_mock_001", model: "mock-model", usage: { input_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude mock" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } else if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "one" } }] })}\n\n`);
      setTimeout(() => response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { content: " two" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join("")), 15);
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: input.prompt || "mock json" } }] }));
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
  return worker.fetch(request, { UPSTREAM_ORIGIN: upstreamOrigin });
}

test("translates OpenAI JSON response to Claude with the production translator", async () => {
  const response = await invoke({ prompt: "json", stream: false }, undefined, {
    "x-poc-client-format": "claude",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, "message");
  assert.equal(body.content[0].text, "json");
});

test("translates Claude multi-event SSE to OpenAI with the production translator", async () => {
  const response = await invoke({ model: "mock-model", messages: [], stream: true }, undefined, {
    "x-poc-upstream-format": "claude",
  });
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const text = await response.text();
  assert.match(text, /Hello from Claude mock/);
  assert.match(text, /finish_reason/);
});

test("preserves upstream non-2xx status and body", async () => {
  const response = await invoke({ mode: "error" });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "mock rate limit" });
});

test("aborts the upstream fetch when the client aborts", async () => {
  const controller = new AbortController();
  const response = await invoke({ mode: "abort", stream: true }, controller.signal, {
    "x-poc-client-format": "claude",
  });
  const reader = response.body.getReader();
  const firstChunk = await reader.read();
  assert.ok(firstChunk.value?.length);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(upstreamAborted, true);
});
