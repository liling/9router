import "../../open-sse/translator/register-serverless.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getExecutor, RuntimeCapabilityError } from "../../open-sse/executors/serverless.js";
import { installRuntime, getRuntime } from "../../open-sse/runtime/context.js";
import { composeCloudflareBaseRuntime, composeCloudflareRequestRuntime } from "../../open-sse/runtime/adapters/cloudflareProduction.js";
import { createCloudflareBackgroundTasks } from "../../open-sse/runtime/adapters/cloudflareBackgroundTasks.js";
import { createD1ApiKeyRepository } from "../../open-sse/runtime/adapters/d1/apiKeyRepository.js";
import { createD1EphemeralStore } from "../../open-sse/runtime/adapters/d1/ephemeralStore.js";
import { registerExecutorFetch } from "../../open-sse/utils/executorFetch.js";
import { formatSSE, parseSSELine } from "../../open-sse/utils/streamHelpers.js";
import { SSE_DONE } from "../../open-sse/utils/sseConstants.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const runtime = composeCloudflareBaseRuntime();
installRuntime(runtime);
registerExecutorFetch(runtime.ports.httpTransport);

function translateJSONResponse(body, state, clientFormat) {
  const message = body.choices?.[0]?.message || {};
  const chunks = [
    { id: body.id, model: body.model, choices: [{ delta: { role: "assistant", ...message } }] },
    { id: body.id, model: body.model, choices: [{ delta: {}, finish_reason: body.choices?.[0]?.finish_reason || "stop" }] },
  ];
  const events = chunks.flatMap((chunk) => translateResponse(FORMATS.OPENAI, clientFormat, chunk, state) || []);
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

function translateSSE(body, clientFormat, onCancel) {
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
        const parsed = parseSSELine(line.trim(), FORMATS.OPENAI);
        if (!parsed || parsed.done) continue;
        const translated = translateResponse(FORMATS.OPENAI, clientFormat, parsed, state) || [];
        for (const item of translated) controller.enqueue(encoder.encode(formatSSE(item, clientFormat)));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim(), FORMATS.OPENAI);
        if (parsed && !parsed.done) {
          const translated = translateResponse(FORMATS.OPENAI, clientFormat, parsed, state) || [];
          for (const item of translated) controller.enqueue(encoder.encode(formatSSE(item, clientFormat)));
        }
      }
      if (clientFormat === FORMATS.OPENAI) controller.enqueue(encoder.encode(SSE_DONE));
    },
  });

  const reader = body.pipeThrough(transform).getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      onCancel?.(reason);
      await reader.cancel(reason);
    },
  });
}

const backgroundProbeState = new Map();

export default {
  async fetch(request, env, executionContext) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === "/health") {
      return Response.json({ ok: true, runtime: "worker", profile: runtime.descriptor.id });
    }

    if (incomingUrl.pathname.startsWith("/probe/validation/") &&
        (env.VALIDATION_MODE !== "true" || !env.VALIDATION_PROBE_TOKEN ||
          request.headers.get("x-validation-token") !== env.VALIDATION_PROBE_TOKEN)) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (incomingUrl.pathname === "/probe/validation/missing-binding" && request.method === "GET") {
      try {
        composeCloudflareRequestRuntime({
          baseRuntime: getRuntime(), env: { ...env, DB: undefined }, executionContext,
          createApiKeyRepository: createD1ApiKeyRepository,
          createEphemeralStore: createD1EphemeralStore,
          createBackgroundTasks: createCloudflareBackgroundTasks,
        });
        return Response.json({ error: "missing_binding_was_accepted" }, { status: 500 });
      } catch (error) {
        return error.message === "Missing required runtime dependency: D1"
          ? Response.json({ failClosed: true })
          : Response.json({ error: "unexpected_validation_failure" }, { status: 500 });
      }
    }

    let requestRuntime;
    try {
      requestRuntime = composeCloudflareRequestRuntime({
        baseRuntime: getRuntime(), env, executionContext,
        createApiKeyRepository: createD1ApiKeyRepository,
        createEphemeralStore: createD1EphemeralStore,
        createBackgroundTasks: createCloudflareBackgroundTasks,
      });
    } catch (error) {
      return Response.json({ error: "runtime_dependency_unavailable", message: error.message }, { status: 500 });
    }

    if (incomingUrl.pathname === "/probe/validation/persistence" && request.method === "POST") {
      const { key, value } = await request.json();
      if (typeof key !== "string" || !key.startsWith("validation:") || typeof value !== "string") {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      await env.DB.prepare("INSERT OR REPLACE INTO probe_records (key, value) VALUES (?, ?)").bind(key, value).run();
      return Response.json({ written: true });
    }

    if (incomingUrl.pathname.startsWith("/probe/validation/persistence/") && request.method === "GET") {
      const key = decodeURIComponent(incomingUrl.pathname.slice("/probe/validation/persistence/".length));
      const row = await env.DB.prepare("SELECT key, value FROM probe_records WHERE key = ?").bind(key).first();
      return row ? Response.json(row) : Response.json({ error: "not_found" }, { status: 404 });
    }

    if (incomingUrl.pathname === "/probe/validation/ephemeral" && request.method === "POST") {
      const { namespace, key, value } = await request.json();
      if (![namespace, key, value].every((item) => typeof item === "string")) {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      const ephemeral = requestRuntime.assertPort("ephemeral");
      await ephemeral.put(namespace, key, value, { ttlMs: 60_000 });
      return Response.json({ written: true });
    }

    if (incomingUrl.pathname.startsWith("/probe/validation/ephemeral/") && request.method === "GET") {
      const [, , , , namespace, key] = incomingUrl.pathname.split("/");
      if (!namespace || !key) return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      const value = await requestRuntime.assertPort("ephemeral").peek(namespace, key);
      return value ? Response.json({ namespace, key, value }) : Response.json({ error: "not_found" }, { status: 404 });
    }

    if (incomingUrl.pathname === "/probe/validation/background" && request.method === "POST") {
      const { id } = await request.json();
      if (typeof id !== "string" || !/^validation:[a-zA-Z0-9-]+$/.test(id)) {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      requestRuntime.assertPort("backgroundTasks").enqueue({
        id,
        execute: () => env.DB.prepare("INSERT OR REPLACE INTO validation_background (id, completed_at) VALUES (?, CURRENT_TIMESTAMP)").bind(id).run(),
      });
      return Response.json({ accepted: true, durable: false });
    }

    if (incomingUrl.pathname.startsWith("/probe/validation/background/") && request.method === "GET") {
      const id = decodeURIComponent(incomingUrl.pathname.slice("/probe/validation/background/".length));
      const row = await env.DB.prepare("SELECT id, completed_at FROM validation_background WHERE id = ?").bind(id).first();
      return row ? Response.json({ completed: true, durable: false, ...row }) : Response.json({ completed: false, durable: false });
    }

    if (incomingUrl.pathname === "/probe/validation/context" && request.method === "POST") {
      const { requestId, value } = await request.json();
      if (typeof requestId !== "string" || typeof value !== "string") {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      const ephemeral = requestRuntime.assertPort("ephemeral");
      const namespace = `validation:request-context:${requestId}`;
      await ephemeral.put(namespace, "context", value, { ttlMs: 60_000 });
      const isolatedValue = await ephemeral.peek(namespace, "context");
      return Response.json({ requestId, value: isolatedValue, profile: requestRuntime.descriptor.id });
    }

    if (incomingUrl.pathname === "/probe/background" && request.method === "POST") {
      const id = crypto.randomUUID();
      backgroundProbeState.set(id, "pending");
      requestRuntime.assertPort("backgroundTasks").enqueue({
        id,
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          backgroundProbeState.set(id, "finished");
        },
      });
      return Response.json({ id, state: backgroundProbeState.get(id) });
    }

    if (incomingUrl.pathname.startsWith("/probe/background/") && request.method === "GET") {
      const id = incomingUrl.pathname.slice("/probe/background/".length);
      const state = backgroundProbeState.get(id);
      return state ? Response.json({ id, state }) : Response.json({ error: "not_found" }, { status: 404 });
    }

    if (incomingUrl.pathname === "/probe/local-only") {
      try {
        getExecutor("devin-cli");
        return Response.json({ error: "local_only_executor_was_allowed" }, { status: 500 });
      } catch (error) {
        if (!(error instanceof RuntimeCapabilityError)) throw error;
        return Response.json({ error: error.name, code: error.code }, { status: 403 });
      }
    }

    if (incomingUrl.pathname === "/probe/d1" && request.method === "POST") {
      const { key, value } = await request.json();
      const ephemeral = requestRuntime.assertPort("ephemeral");
      await ephemeral.put("worker-probe", key, { key, value }, { ttlMs: 60_000 });
      const row = await ephemeral.peek("worker-probe", key);
      return Response.json({ row, executor: getExecutor("openai").getProvider() });
    }

    if (incomingUrl.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (!env.UPSTREAM_ORIGIN) return Response.json({ error: "missing_upstream_origin" }, { status: 500 });

    const clientFormat = request.headers.get("x-poc-client-format") === FORMATS.OPENAI
      ? FORMATS.OPENAI
      : FORMATS.CLAUDE;
    const payload = await request.json();
    const model = payload.model || "mock-model";
    const credentials = {
      apiKey: "mock-token",
      runtimeTransport: {
        baseUrl: env.UPSTREAM_ORIGIN,
        urlSuffix: "/v1/chat/completions",
        headers: { accept: payload.stream ? "text/event-stream" : "application/json" },
      },
    };
    const executionAbort = new AbortController();
    if (request.signal.aborted) executionAbort.abort(request.signal.reason);
    else request.signal.addEventListener("abort", () => executionAbort.abort(request.signal.reason), { once: true });

    try {
      const translatedRequest = translateRequest(
        clientFormat,
        FORMATS.OPENAI,
        model,
        payload,
        Boolean(payload.stream),
        credentials,
        "openai",
      );
      const { response: upstreamResponse } = await getExecutor("openai").execute({
        model,
        body: translatedRequest,
        stream: Boolean(payload.stream),
        credentials,
        signal: executionAbort.signal,
      });
      if (!upstreamResponse.ok) return upstreamResponse;
      if (clientFormat === FORMATS.OPENAI) return upstreamResponse;

      const state = initState(clientFormat);
      if (!payload.stream) {
        return Response.json(translateJSONResponse(await upstreamResponse.json(), state, clientFormat));
      }

      return new Response(translateSSE(upstreamResponse.body, clientFormat, () => executionAbort.abort()), {
        status: upstreamResponse.status,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
      });
    } catch (error) {
      if (executionAbort.signal.aborted) throw error;
      return Response.json({ error: "upstream_unavailable" }, { status: 502, headers: jsonHeaders });
    }
  },
};
