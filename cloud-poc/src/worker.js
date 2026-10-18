import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../../open-sse/translator/response/claude-to-openai.js";
import "../../open-sse/translator/response/openai-to-claude.js";
import { formatSSE, parseSSELine } from "../../open-sse/utils/streamHelpers.js";
import { SSE_DONE } from "../../open-sse/utils/sseConstants.js";
import { getWorkerExecutor } from "./worker-executors.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function translateJSONResponse(body, state) {
  const message = body.choices?.[0]?.message || {};
  const chunks = [
    { id: body.id, model: body.model, choices: [{ delta: { role: "assistant", ...message } }] },
    { id: body.id, model: body.model, choices: [{ delta: {}, finish_reason: body.choices?.[0]?.finish_reason || "stop" }] },
  ];
  const events = chunks.flatMap((chunk) => translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk, state) || []);
  const messageStart = events.find((event) => event.type === "message_start")?.message || {};
  const content = [];
  for (const event of events) {
    if (event.type === "content_block_start") content[event.index] = event.content_block;
    if (event.type === "content_block_delta") {
      const block = content[event.index];
      if (block?.type === "text") block.text += event.delta.text || "";
      if (block?.type === "thinking") block.thinking += event.delta.thinking || "";
    }
  }
  const delta = events.find((event) => event.type === "message_delta")?.delta || {};
  return {
    id: messageStart.id || body.id,
    type: "message",
    role: "assistant",
    model: messageStart.model || body.model,
    content: content.filter(Boolean),
    stop_reason: delta.stop_reason || "end_turn",
    stop_sequence: delta.stop_sequence || null,
    usage: messageStart.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

function translateSSE(body, upstreamFormat, clientFormat) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = initState(clientFormat);
  let buffer = "";

  const transform = new TransformStream({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const parsed = parseSSELine(line.trim(), upstreamFormat);
        if (!parsed || parsed.done) continue;
        const translated = translateResponse(upstreamFormat, clientFormat, parsed, state) || [];
        for (const item of translated) controller.enqueue(encoder.encode(formatSSE(item, clientFormat)));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim(), upstreamFormat);
        if (parsed && !parsed.done) {
          const translated = translateResponse(upstreamFormat, clientFormat, parsed, state) || [];
          for (const item of translated) controller.enqueue(encoder.encode(formatSSE(item, clientFormat)));
        }
      }
      if (clientFormat === FORMATS.OPENAI) controller.enqueue(encoder.encode(SSE_DONE));
    },
  });

  return body.pipeThrough(transform);
}

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === "/health") {
      return Response.json({ ok: true, runtime: "worker" });
    }

    if (incomingUrl.pathname === "/probe/d1" && request.method === "POST") {
      if (!env.DB) return Response.json({ error: "missing_d1_binding" }, { status: 500 });
      const { key, value } = await request.json();
      await env.DB.prepare("INSERT OR REPLACE INTO probe_records (key, value) VALUES (?, ?)")
        .bind(key, value).run();
      const row = await env.DB.prepare("SELECT key, value FROM probe_records WHERE key = ?")
        .bind(key).first();
      return Response.json({ row, executor: getWorkerExecutor("openai") });
    }

    if (incomingUrl.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!env.UPSTREAM_ORIGIN) return Response.json({ error: "missing_upstream_origin" }, { status: 500 });

    const upstreamFormat = request.headers.get("x-poc-upstream-format") === FORMATS.CLAUDE
      ? FORMATS.CLAUDE
      : FORMATS.OPENAI;
    const clientFormat = request.headers.get("x-poc-client-format") === FORMATS.CLAUDE
      ? FORMATS.CLAUDE
      : FORMATS.OPENAI;
    const payload = await request.json();
    const upstreamPath = upstreamFormat === FORMATS.CLAUDE ? "/v1/messages" : "/v1/chat/completions";

    try {
      const upstreamResponse = await fetch(new URL(upstreamPath, env.UPSTREAM_ORIGIN), {
        method: "POST",
        headers: { "content-type": "application/json", accept: payload.stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
      if (!upstreamResponse.ok) return upstreamResponse;
      if (upstreamFormat === clientFormat) return upstreamResponse;

      if (!payload.stream) {
        if (upstreamFormat !== FORMATS.OPENAI || clientFormat !== FORMATS.CLAUDE) return upstreamResponse;
        const translated = translateJSONResponse(await upstreamResponse.json(), initState(clientFormat));
        return Response.json(translated);
      }

      return new Response(translateSSE(upstreamResponse.body, upstreamFormat, clientFormat), {
        status: upstreamResponse.status,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return Response.json({ error: "upstream_unavailable" }, { status: 502, headers: jsonHeaders });
    }
  },
};
