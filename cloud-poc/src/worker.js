import { getExecutor, RuntimeCapabilityError } from "../../open-sse/executors/serverless.js";
import { handleWorkerChatCore, isWorkerProviderSupported } from "../../open-sse/handlers/chatCoreWorker.js";
import { installRuntime, getRuntime } from "../../open-sse/runtime/context.js";
import { composeCloudflareBaseRuntime, composeCloudflareRequestRuntime } from "../../open-sse/runtime/adapters/cloudflareProduction.js";
import { createCloudflareBackgroundTasks } from "../../open-sse/runtime/adapters/cloudflareBackgroundTasks.js";
import { createD1ApiKeyRepository } from "../../open-sse/runtime/adapters/d1/apiKeyRepository.js";
import { createD1EphemeralStore } from "../../open-sse/runtime/adapters/d1/ephemeralStore.js";
import { createD1ConnectionRepository } from "../../open-sse/runtime/adapters/d1/connectionRepository.js";
import { createCloudflareSecretProvider } from "../../open-sse/runtime/adapters/cloudflareSecretProvider.js";
import { credentialFallbackIterator } from "../../open-sse/runtime/credentials/resolver.js";
import { registerExecutorFetch } from "../../open-sse/utils/executorFetch.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const runtime = composeCloudflareBaseRuntime();
installRuntime(runtime);
registerExecutorFetch(runtime.ports.httpTransport);

function withCancelTelemetry(response, telemetry, executionAbort) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      telemetry.cancelDispatchedAt = new Date().toISOString();
      executionAbort.abort();
      await reader.cancel(reason);
    },
  }), { status: response.status, headers: response.headers });
}

const backgroundProbeState = new Map();
const cancelTelemetry = new Map();
const maxCancelTelemetryEntries = 1024;

export default {
  async fetch(request, env, executionContext) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname.startsWith("/probe/cancel-telemetry/") && request.method === "GET") {
      const requestId = decodeURIComponent(incomingUrl.pathname.slice("/probe/cancel-telemetry/".length));
      const record = cancelTelemetry.get(requestId) || null;
      if (record) cancelTelemetry.delete(requestId);
      return Response.json({ record });
    }

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
          createSecretProvider: createCloudflareSecretProvider,
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
        createSecretProvider: createCloudflareSecretProvider,
      });
    } catch (error) {
      return Response.json({ error: "runtime_dependency_unavailable", message: error.message }, { status: 500 });
    }

    if (incomingUrl.pathname === "/probe/validation/persistence" && request.method === "POST") {
      const { key } = await request.json();
      if (typeof key !== "string" || !/^validation:[a-zA-Z0-9-]+$/.test(key)) {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      const repository = requestRuntime.assertPort("persistence");
      await repository.insert({
        id: key,
        key,
        name: "MEM-475 validation probe",
        machineId: null,
        isActive: false,
        createdAt: new Date().toISOString(),
        access: { restricted: false, allow: [] },
      });
      return Response.json({ written: true });
    }

    if (incomingUrl.pathname.startsWith("/probe/validation/persistence/") && request.method === "GET") {
      const key = decodeURIComponent(incomingUrl.pathname.slice("/probe/validation/persistence/".length));
      if (!/^validation:[a-zA-Z0-9-]+$/.test(key)) return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      const repository = requestRuntime.assertPort("persistence");
      const record = await repository.findByKey(key);
      if (!record) return Response.json({ error: "not_found" }, { status: 404 });
      const deleted = await repository.delete(record.id);
      return Response.json({ record, deleted });
    }

    if (incomingUrl.pathname === "/probe/validation/cleanup" && request.method === "POST") {
      const { suffix } = await request.json();
      if (typeof suffix !== "string" || !/^[a-zA-Z0-9-]+$/.test(suffix)) {
        return Response.json({ error: "invalid_probe_input" }, { status: 400 });
      }
      const outcomes = {};
      const attempt = async (name, action) => {
        try { outcomes[name] = await action(); }
        catch { outcomes[name] = "failed"; }
      };
      const persistence = requestRuntime.assertPort("persistence");
      const ephemeral = requestRuntime.assertPort("ephemeral");
      await attempt("api_keys", async () => (await persistence.delete(`validation:${suffix}`)) ? "deleted" : "absent");
      await attempt("ephemeral_probe", async () => (await ephemeral.delete(`validation-a-${suffix}`, suffix)) ? "deleted" : "absent");
      await attempt("ephemeral_isolation", async () => (await ephemeral.delete(`validation-b-${suffix}`, suffix)) ? "deleted" : "absent");
      let contextsDeleted = 0;
      let contextsFailed = false;
      for (let index = 0; index < 12; index += 1) {
        try {
          if (await ephemeral.delete(`validation:request-context:${suffix}-${index}`, "context")) contextsDeleted += 1;
        } catch { contextsFailed = true; }
      }
      outcomes.ephemeral_context = contextsFailed ? "failed" : `cleaned:${contextsDeleted}`;
      await attempt("validation_background", async () => {
        const result = await env.DB.prepare("DELETE FROM validation_background WHERE id = ?")
          .bind(`validation:${suffix}`).run();
        return `cleaned:${result.meta?.changes || 0}`;
      });
      const failed = Object.values(outcomes).some((value) => value === "failed");
      return Response.json({ outcomes }, { status: failed ? 500 : 200 });
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
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    while (cancelTelemetry.size >= maxCancelTelemetryEntries) {
      cancelTelemetry.delete(cancelTelemetry.keys().next().value);
    }
    const telemetry = { requestId, receivedAt: new Date().toISOString(), cancelDispatchedAt: null };
    cancelTelemetry.set(requestId, telemetry);

    const payload = await request.json();
    const model = payload.model;
    const providerId = payload.providerId;
    if (typeof providerId !== "string" || !providerId || typeof model !== "string" || !model) {
      return Response.json({ error: "credential_unsupported", requestId }, { status: 400 });
    }
    if (!isWorkerProviderSupported(providerId)) {
      return Response.json({ error: "credential_unsupported", requestId }, { status: 400 });
    }
    try { getExecutor(providerId); }
    catch { return Response.json({ error: "credential_unsupported", requestId }, { status: 400 }); }
    const executionAbort = new AbortController();
    if (request.signal.aborted) executionAbort.abort(request.signal.reason);
    else request.signal.addEventListener("abort", () => executionAbort.abort(request.signal.reason), { once: true });

    try {
      const connectionRepository = createD1ConnectionRepository(env.DB);
      const attempts = credentialFallbackIterator({
        providerId,
        model,
        repository: connectionRepository,
        secretProvider: requestRuntime.assertPort("secret"),
      });
      let clientResponse;
      for await (const resolved of attempts) {
        const result = await handleWorkerChatCore({
          body: payload,
          provider: providerId,
          model,
          credentials: resolved,
          signal: executionAbort.signal,
          userAgent: request.headers.get("user-agent") || "",
        });
        clientResponse = result.response;
        if (clientResponse.status !== 401 && clientResponse.status !== 403) break;
        try {
          await connectionRepository.markUnavailable({
            id: resolved.connectionId, status: "unauthorized", model,
          });
        } catch {
          return Response.json({ error: "credential_source_unavailable", requestId }, { status: 503 });
        }
      }
      if (!clientResponse) return Response.json({ error: "credential_unavailable", requestId }, { status: 503 });
      if (clientResponse.status === 401 || clientResponse.status === 403) {
        return Response.json({ error: "credential_unavailable", requestId }, { status: 503 });
      }
      if (clientResponse.ok && payload.stream) {
        clientResponse = withCancelTelemetry(clientResponse, telemetry, executionAbort);
      }
      return clientResponse;
    } catch (error) {
      if (executionAbort.signal.aborted) throw error;
      const code = ["credential_unavailable", "credential_source_unavailable", "credential_unsupported", "credential_strategy_unsupported"].includes(error.code)
        ? error.code : "upstream_unavailable";
      const headers = new Headers(jsonHeaders);
      if (Number.isFinite(error.retryAfterAt) && error.retryAfterAt > Date.now()) {
        headers.set("retry-after", String(Math.max(1, Math.ceil((error.retryAfterAt - Date.now()) / 1000))));
      }
      const status = code === "credential_strategy_unsupported" || code === "credential_unsupported" ? 400
        : code.startsWith("credential_") ? 503 : 502;
      return Response.json({ error: code, requestId }, { status, headers });
    }
  },
};
