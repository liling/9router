import worker from "../src/worker.js";
import { createD1ApiKeyRepository } from "../../open-sse/runtime/adapters/d1/apiKeyRepository.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/probe/d1/api-keys" || request.method !== "POST") {
      return worker.fetch(request, env);
    }
    const repository = createD1ApiKeyRepository(env.DB);
    const { operation, record, id, key } = await request.json();
    try {
      if (operation === "list") return Response.json(await repository.list());
      if (operation === "findById") return Response.json(await repository.findById(id));
      if (operation === "findByKey") return Response.json(await repository.findByKey(key));
      if (operation === "insert") return Response.json(await repository.insert(record));
      if (operation === "update") return Response.json(await repository.update(record));
      if (operation === "delete") return Response.json({ deleted: await repository.delete(id) });
      return Response.json({ error: "unknown_operation" }, { status: 400 });
    } catch (error) {
      return Response.json({ error: error.name, code: error.code, message: error.message }, {
        status: error.code === "PERSISTENCE_CONFLICT" ? 409 : error.code === "PERSISTENCE_NOT_FOUND" ? 404 : 500,
      });
    }
  },
};
