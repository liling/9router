# Worker compatibility PoC

This isolated Worker forwards an OpenAI-style chat request to a configurable mock upstream. It deliberately leaves the existing Router Core and Local runtime untouched; it tests the Worker request/stream boundary rather than claiming full provider translation compatibility.

## Local checks

From this directory:

```sh
npm install
npm test
npm run build
```

`npm test` runs JSON, multiple-chunk SSE, non-2xx passthrough, and client-abort tests against a local HTTP upstream. To exercise Wrangler's local Worker runtime end-to-end, run `npm run mock` in one terminal and `npm run dev -- --ip 127.0.0.1 --port 8787` in another, then send requests to `http://127.0.0.1:8787/v1/chat/completions`:

```sh
curl -i -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"prompt":"json"}'
curl -N -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"stream":true}'
curl -i -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"mode":"error"}'
```

Set `{"mode":"abort"}` and cancel the client request to exercise the cancellation path. The deterministic automated test verifies that the upstream connection closes when the downstream signal is aborted.

## Limits

- This is an isolated HTTP/streaming probe, not a complete `open-sse` translation or provider execution path.
- `UPSTREAM_ORIGIN` uses a local address for Wrangler development; configure a reachable service before deployment.
- Wrangler local request durations are wall-clock observations, not Cloudflare CPU measurements. Remote CPU evidence needs authenticated Cloudflare execution and is outside this lane.

## D1 and executor boundary

`POST /probe/d1` accepts `{ "key", "value" }`, then performs an async D1
write and read using the root Wrangler `DB` binding. Apply the minimal schema
with `npx wrangler d1 execute lane-b --local --file=migrations/0001_probe.sql`.
The D1 promise API is asynchronous and does not satisfy the existing
synchronous SQLite adapter contract; this probe deliberately does not refactor
that adapter.

`src/worker-executors.js` is a Worker-only allow-list with no imports from
`open-sse/executors/index.js`. The production index statically imports and
constructs all specialized executors, including Cursor (Node HTTP/2 AgentService
transport) and Devin CLI (`node:child_process`, filesystem, OS, readline).
Ollama is host-local; other Node/local providers also require capability
classification. The Worker entry stays independent of that static graph. This
is a minimal boundary proof, not a production registry migration.
