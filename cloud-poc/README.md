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
