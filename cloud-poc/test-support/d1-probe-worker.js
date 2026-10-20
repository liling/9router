import worker from "../src/worker.js";
import { getRuntime } from "../../open-sse/runtime/context.js";
import { composeCloudflareRequestRuntime } from "../../open-sse/runtime/adapters/cloudflareProduction.js";
import { createCloudflareBackgroundTasks } from "../../open-sse/runtime/adapters/cloudflareBackgroundTasks.js";
import { createD1ApiKeyRepository } from "../../open-sse/runtime/adapters/d1/apiKeyRepository.js";
import { createD1EphemeralStore } from "../../open-sse/runtime/adapters/d1/ephemeralStore.js";

function requestRuntime(env, executionContext, ephemeralOptions) {
  return composeCloudflareRequestRuntime({
    baseRuntime: getRuntime(), env, executionContext, ephemeralOptions,
    createApiKeyRepository: createD1ApiKeyRepository,
    createEphemeralStore: createD1EphemeralStore,
    createBackgroundTasks: createCloudflareBackgroundTasks,
  });
}

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    if (url.pathname !== "/probe/d1/api-keys" || request.method !== "POST") {
      if (url.pathname === "/probe/d1/ephemeral" && request.method === "POST") {
        const { operation, namespace, key, value, options, now } = await request.json();
        const runtime = requestRuntime(env, executionContext, { now: () => now });
        const store = runtime.assertPort("ephemeral");
        try {
          if (operation === "put") return Response.json({ result: await store.put(namespace, key, value, options) });
          if (operation === "peek") return Response.json({ result: await store.peek(namespace, key) });
          if (operation === "consume") return Response.json({ result: await store.consume(namespace, key) });
          if (operation === "delete") return Response.json({ result: await store.delete(namespace, key) });
          return Response.json({ error: "unknown_operation" }, { status: 400 });
        } catch (error) {
          const status = error.code === "EPHEMERAL_CONFLICT" ? 409 : error.code === "EPHEMERAL_INVALID_TTL" ? 400 : 500;
          return Response.json({ error: error.name, code: error.code, message: error.message }, { status });
        }
      }
      return worker.fetch(request, env, executionContext);
    }
    const runtime = requestRuntime(env, executionContext);
    const repository = runtime.assertPort("persistence");
    const { operation, record, id, key, patch } = await request.json();
    try {
      if (operation === "list") return Response.json(await repository.list());
      if (operation === "findById") return Response.json(await repository.findById(id));
      if (operation === "findByKey") return Response.json(await repository.findByKey(key));
      if (operation === "insert") return Response.json(await repository.insert(record));
      if (operation === "update") return Response.json(await repository.update(id, patch));
      if (operation === "delete") return Response.json({ deleted: await repository.delete(id) });
      return Response.json({ error: "unknown_operation" }, { status: 400 });
    } catch (error) {
      return Response.json({ error: error.name, code: error.code, message: error.message }, {
        status: error.code === "PERSISTENCE_CONFLICT" ? 409 : error.code === "PERSISTENCE_NOT_FOUND" ? 404 : 500,
      });
    }
  },
};
