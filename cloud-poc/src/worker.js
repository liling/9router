import { getWorkerExecutor } from "./worker-executors.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === "/health") {
      return Response.json({ ok: true, runtime: "worker" });
    }

    if (incomingUrl.pathname === "/probe/d1" && request.method === "POST") {
      if (!env.DB) {
        return Response.json({ error: "missing_d1_binding" }, { status: 500 });
      }
      const { key, value } = await request.json();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO probe_records (key, value) VALUES (?, ?)",
      ).bind(key, value).run();
      const row = await env.DB.prepare(
        "SELECT key, value FROM probe_records WHERE key = ?",
      ).bind(key).first();
      return Response.json({ row, executor: getWorkerExecutor("openai") });
    }

    if (incomingUrl.pathname !== "/v1/chat/completions" || request.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    if (!env.UPSTREAM_ORIGIN) {
      return Response.json({ error: "missing_upstream_origin" }, { status: 500 });
    }

    const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, env.UPSTREAM_ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete("host");

    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.body,
        signal: request.signal,
        duplex: "half",
      });
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return Response.json({ error: "upstream_unavailable" }, { status: 502, headers: jsonHeaders });
    }
  },
};
