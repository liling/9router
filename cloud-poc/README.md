# Worker compatibility PoC

This Worker PoC exercises the production OpenAI↔Claude request/response translators and the production `DefaultExecutor` through the shared Worker handler boundary (`open-sse/handlers/chatCoreWorker.js`). A Claude-shaped client request is translated to OpenAI format, sent by the serverless executor to the registry provider URL resolved from the T2 connection credentials, and translated back to Claude format by the production non-streaming/streaming handlers.

## Local checks

From this directory:

```sh
npm ci
npm test
npm run build
```

`npm test` runs a real Wrangler/Workerd end-to-end test that applies the D1 migrations, verifies the deployable Worker's probe and API-key boundary, exercises concurrent request-scoped D1 ephemeral stores, and checks Local-only capability denial. Chat JSON/SSE, forced OpenAI streaming to JSON, 401 connection fallback with request-local exclusions, concurrent credential isolation, unsupported-provider rejection, credential non-emission, and client-abort propagation run in Node against the production executor through an in-process `http-fetch` port redirect to an offline fixture (`test/worker.test.js`, `test/worker-cancel-chain.test.js`). `test/chat-worker-boundary.test.js` guards the Worker chat import graph.

The chat endpoint takes the provider id and model in the request body and resolves that provider's connection and secret per request:

```sh
curl -i -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"providerId":"openai","model":"gpt-4.1-mini","system":"test","messages":[{"role":"user","content":"json"}]}'
curl -N -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"providerId":"openai","model":"gpt-4.1-mini","system":"test","messages":[{"role":"user","content":"stream"}],"stream":true}'
```

## Limits

- The Worker selects only the approved serverless translator entry and `DefaultExecutor`; it does not load the eager Local executor registry.
- No loopback origin is configured: the executor target comes from the provider registry, and request credentials come from the T2 connection resolver (API-key providers: `openai`, `anthropic`, `deepseek`, `mistral`, `groq`, `xai`). Offline tests redirect the `http-fetch` port to a local fixture instead of reconfiguring the Worker.
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
the provider registry entry, so the test uses the same production executor
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
