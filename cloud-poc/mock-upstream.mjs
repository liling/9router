import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
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
