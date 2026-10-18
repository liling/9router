import { getWorkerExecutor } from "./worker-executors.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/probe/d1" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { key, value } = await request.json();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO probe_records (key, value) VALUES (?, ?)",
    ).bind(key, value).run();
    const row = await env.DB.prepare(
      "SELECT key, value FROM probe_records WHERE key = ?",
    ).bind(key).first();

    return Response.json({ row, executor: getWorkerExecutor("openai") });
  },
};
