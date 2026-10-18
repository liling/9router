# Worker compatibility PoC

This Worker PoC exercises the production OpenAI↔Claude request/response translators and the production `DefaultExecutor` against a configurable mock upstream. A Claude-shaped client request is translated to OpenAI format, sent through `executors/serverless.js` using `credentials.runtimeTransport`, then translated back to Claude format.

## Local checks

From this directory:

```sh
npm install
npm test
npm run build
```

`npm test` runs a real Wrangler/Workerd end-to-end test for JSON, multi-chunk SSE, non-2xx passthrough, client abort, and Local-only capability denial against a local mock upstream. It also runs fast Node-level boundary and translator parity tests. To run Wrangler manually, start `npm run mock` and `npm run dev -- --ip 127.0.0.1 --port 8787` in separate terminals, then send a Claude-shaped request to `http://127.0.0.1:8787/v1/chat/completions`:

```sh
curl -i -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"model":"mock-model","max_tokens":32,"messages":[{"role":"user","content":"json"}]}'
curl -N -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"model":"mock-model","max_tokens":32,"messages":[{"role":"user","content":"stream"}],"stream":true}'
curl -i -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"model":"mock-error","messages":[{"role":"user","content":"fail"}]}'
```

Set model to `mock-abort` and cancel the client request to exercise the cancellation path. The deterministic automated test verifies that cancelling the downstream response closes the production executor's upstream connection.

## Limits

- The Worker selects only the approved serverless translator entry and `DefaultExecutor`; it does not load the eager Local executor registry.
- `UPSTREAM_ORIGIN` uses a local address for Wrangler development; configure a reachable service before deployment.
- Wrangler local request durations are wall-clock observations, not Cloudflare CPU measurements. Remote CPU evidence needs authenticated Cloudflare execution and is outside this lane.

## D1 and executor boundary

`POST /probe/d1` accepts `{ "key", "value" }`, then performs an async D1
write and read using the root Wrangler `DB` binding. Apply the minimal schema
with `npx wrangler d1 execute lane-b --local --file=migrations/0001_probe.sql`.
The D1 promise API is asynchronous and does not satisfy the existing
synchronous SQLite adapter contract; this probe deliberately does not refactor
that adapter.

`open-sse/executors/serverless.js` is the selected Worker registry. It imports
only `DefaultExecutor` and explicitly rejects the local-only executors listed
in the production capability table. The Worker obtains its upstream URL from
`credentials.runtimeTransport`, so the test uses the same production executor
path rather than a Worker-local fetch adapter.

## Runtime capability matrix

| Capability | Worker profile | Notes |
| --- | --- | --- |
| Default HTTP executor, JSON/SSE translation | supported | Uses the production serverless executor and selected translator registration. |
| `node:crypto`, `node:os`, `node:stream` | supported | Supplied by the Workerd `nodejs_compat` profile. |
| `vercel-relay` | supported | Uses ambient Worker `fetch`. |
| Worker proxy dispatch | conditional (port-required) | Requires a runtime-specific proxy transport adapter. |
| `proxy-transport` | local-only (port-required) | Requires the Local proxy transport port. |
| `mitm-dns-bypass` | local-only (port-required) | Requires Local DNS resolution behavior. |
| `insecure-tls-retry` | local-only (port-required) | Requires Local TLS agent behavior. |
| `remote-image-fetch` | local-only | Future support requires an explicit runtime port; no Worker fetch fallback is provided. |

### Known blockers and boundaries

- The `9c518c1` Phase 0 baseline has 45 failed files / 113 failed tests. Its
  seven Phase 0 failure files are `unit/claude-thinking-stream-boundaries.test.js`,
  `unit/minimax-transport-target-format.test.js`,
  `unit/ollama-stream-tail.test.js`,
  `unit/openai-responses-completed-usage.test.js`,
  `unit/openai-responses-completion-watchdog.test.js`,
  `unit/openai-responses-usage-completed.test.js`, and
  `unit/openai-responses-usage-pivot.test.js`.
- The test-closeout baseline at `551420ff` had 220 failed suites / 160 failed
  tests; the lane had 220 failed suites / 159 failed tests (zero new failure
  assertions, one repaired in `translator-registration-contract.test.js`).
  The Codex lead-time test is a Phase 0 expectation mismatch: it expects five
  days while the provider registry configures `600000` ms.
- Wrangler dry-run completes and the bundle metafile excludes `undici`,
  `node:sqlite`, `node:dns`, `node:https`, `node:net`, `node:child_process`,
  `bun:*`, and `proxyFetch.js` from the Worker output.
- Root `npm ci` is unavailable because the repository has no root lockfile. In this
  environment, npm blocks the `better-sqlite3` and `unrs-resolver` install
  scripts; they are not approved or bypassed.
- Phase 2 hardening: `src/lib/oauth/providers/index.js` imports the
  `open-sse/index.js` aggregate entry in reverse; this lane does not change it.
- Persistence and OAuth execution remain outside this Worker boundary. D1's
  async API does not implement the current synchronous SQLite adapter contract.

### Boundary verdict draft

`SERVERLESS_RUNTIME_BOUNDARY_CONDITIONAL`: the production executor/translator
Worker path and bundle boundary are verified, while proxy transport, MITM DNS
bypass, insecure TLS retry, persistence, OAuth, and npm install-script
environment constraints remain outside the supported Worker profile.
