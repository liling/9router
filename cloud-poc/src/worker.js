const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === "/health") {
      return Response.json({ ok: true, runtime: "worker" });
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
