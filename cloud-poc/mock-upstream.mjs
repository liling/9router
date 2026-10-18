import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || !["/v1/chat/completions", "/v1/messages"].includes(request.url)) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  let body = "";
  for await (const chunk of request) body += chunk;
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  if (input.mode === "error") {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "mock rate limit" } }));
    return;
  }

  if (request.url === "/v1/messages") {
    const events = [
      { type: "message_start", message: { id: "msg_mock_001", model: input.model || "mock-model", usage: { input_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude mock" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
      { type: "message_stop" },
    ];
    if (input.stream) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "msg_mock_001",
        type: "message",
        role: "assistant",
        model: input.model || "mock-model",
        content: [{ type: "text", text: "Hello from Claude mock" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 4 },
      }));
    }
    return;
  }

  if (input.mode === "abort") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write("data: {\"delta\":\"first\"}\n\n");
    const timer = setTimeout(() => response.end("data: [DONE]\n\n"), 5000);
    response.on("close", () => clearTimeout(timer));
    return;
  }

  if (input.stream) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const text of ["Hello", " ", "from", " mock"]) {
      if (response.destroyed) return;
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    response.end("data: [DONE]\n\n");
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "Hello from mock" } }] }));
});

const port = Number(process.env.PORT || 8788);
server.listen(port, "127.0.0.1", () => console.log(`mock upstream listening on ${port}`));
