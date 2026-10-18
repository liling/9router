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

  if (input.model === "mock-error") {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "mock rate limit" } }));
    return;
  }

  if (input.model === "mock-abort") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(`data: ${JSON.stringify({ id: "abort-1", model: input.model, choices: [{ delta: { content: "first" } }] })}\n\n`);
    const timer = setTimeout(() => response.end("data: [DONE]\n\n"), 5000);
    response.on("close", () => clearTimeout(timer));
    return;
  }

  if (input.stream) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const text of ["Hello", " ", "from", " mock"]) {
      if (response.destroyed) return;
      response.write(`data: ${JSON.stringify({ id: "chatcmpl-mock", model: input.model, choices: [{ delta: { content: text } }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    response.end("data: [DONE]\n\n");
    return;
  }

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: "chatcmpl-mock",
    model: input.model,
    choices: [{ message: { role: "assistant", content: input.messages?.at(-1)?.content || "Hello from mock" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }));
});

const port = Number(process.env.PORT || 8788);
server.listen(port, "127.0.0.1", () => console.log(`mock upstream listening on ${port}`));
