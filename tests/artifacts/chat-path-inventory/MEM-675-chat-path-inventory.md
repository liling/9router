# MEM-675 — Production chat path inventory (AC1, AC2)

Exact-SHA-bound fact inventory for MEM-660 Phase 8 T1. Read-only: no production
behaviour was changed to produce this document.

## 0. Revision binding

| Field | Value |
|---|---|
| Repository | `https://github.com/liling/9router.git` |
| Exact SHA | `60870d43ac2ea79cd42d456fafdef3968eb5b905` |
| Commit subject | `Merge pull request #47 from liling/mem-659/t2-final-integration` |
| `origin/master` | `60870d43ac2ea79cd42d456fafdef3968eb5b905` (identical to HEAD) |
| Working tree | clean (`git status --short` empty) |
| Environment | Node `v24.21.0`, npm `12.2.0`, Linux |
| Package version | `9router-app@0.5.104` (`package.json`) |

Method: `multica repo checkout https://github.com/liling/9router.git` into
`workdir/9router`; HEAD resolved to the value above and confirmed equal to
`origin/master`.

## 1. Actual production chat call graph (AC1)

### 1.1 Public entrypoints

`next.config.mjs` rewrites are the public surface. Each rewrite lands on one
`src/app/api/v1/*` route; each of those routes calls the same `handleChat`.

| Public path | Route file | Handler |
|---|---|---|
| `/v1/chat/completions` | `src/app/api/v1/chat/completions/route.js` | `handleChat` |
| `/v1/messages` | `src/app/api/v1/messages/route.js` | `handleChat` |
| `/v1/responses` | `src/app/api/v1/responses/route.js` | `handleChat` |
| `/codex/:path*`, `/responses` | `src/app/api/v1/responses/route.js` | `handleChat` |
| `/v1/api/chat` | `src/app/api/v1/api/chat/route.js` | `handleChat` + `transformToOllama` |
| `/v1/:path*` | `src/app/api/v1/...` | dispatch by sub-path |

`src/proxy.js` is the Next.js middleware proxy. It matches
`/((?!_next/static|_next/image|favicon.ico).*)` and delegates to
`dashboardProxy` (`src/dashboardGuard.js`) except for the Xiaomi takeover
branch. `/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses` are in
`PUBLIC_PREFIXES` — the dashboard JWT guard does not apply to them; the `/v1/*`
handlers authenticate their own key.

### 1.2 Ordered call graph

```
POST /v1/chat/completions
  └─ src/app/api/v1/chat/completions/route.js
       ├─ initTranslators()                       open-sse/translator/index.js
       └─ handleChat(request)                     src/sse/handlers/chat.js
            ├─ extractApiKey(request)             src/sse/services/auth.js
            ├─ getSettings()                      src/lib/db/repos/settingsRepo.js  (SQLite)
            ├─ isValidApiKey(apiKey)              src/lib/db/repos/apiKeysRepo.js   (SQLite)
            ├─ getKeyAccessContext(request)       src/sse/services/keyAccess.js     (SQLite)
            ├─ enforceKeyAccess(keyAccess, model) src/sse/services/keyAccess.js
            ├─ handleBypassRequest(...)            open-sse/utils/bypassHandler.js
            ├─ getComboModels(modelStr)            src/lib/db/repos/combosRepo.js   (SQLite)
            ├─ [combo] handleComboChat / handleFusionChat   open-sse/services/combo.js
            └─ handleSingleModelChat(...)          src/sse/handlers/chat.js
                 ├─ getModelInfo(modelStr)          src/sse/services/model.js  (+ localDb)
                 ├─ getProviderCredentials(...)     src/sse/services/auth.js   (SQLite + proxy pools)
                 │    └─ resolveConnectionProxyConfig()  src/lib/network/connectionProxy.js
                 ├─ checkAndRefreshToken(...)       src/sse/services/tokenRefresh.js
                 │    └─ open-sse/services/oauthCredentialManager.js
                 │        └─ open-sse/services/tokenRefresh/providers.js
                 │            └─ src/lib/oauth/services/*.js   (43 files)
                 ├─ getProjectIdForConnection(...)  open-sse/services/projectId.js
                 └─ handleChatCore({...})           open-sse/handlers/chatCore.js
                      ├─ detectFormat(body)          open-sse/services/provider.js
                      ├─ resolveTransport(...)        open-sse/services/provider.js
                      ├─ translateRequest(...)        open-sse/translator/index.js
                      ├─ getExecutor(provider)        open-sse/executors/index.js
                      │    └─ BaseExecutor.execute()  open-sse/executors/base.js
                      │         └─ executorFetch()    open-sse/utils/executorFetch.js
                      │              └─ HttpTransport port  open-sse/runtime/ports/httpTransport.js
                      ├─ handleStreamingResponse()   open-sse/handlers/chatCore/streamingHandler.js
                      ├─ handleNonStreamingResponse() open-sse/handlers/chatCore/nonStreamingHandler.js
                      └─ saveRequestDetail / appendRequestLog  src/lib/usageDb.js → SQLite
```

### 1.3 Response direction

Both response directions go through `open-sse/translator/index.js`
`translateResponse`. `open-sse/handlers/chatCore/streamingHandler.js` and
`open-sse/handlers/chatCore/nonStreamingHandler.js` own the SSE / JSON shape;
`open-sse/utils/stream.js` owns the SSE transform and the usage accounting.

### 1.4 Transport seam

`open-sse/utils/executorFetch.js` is the single upstream egress point. It
resolves in this order:

1. `registeredHttpTransport` — set by `registerExecutorFetch(port.fetch)`; the
   Worker path registers Cloudflare `globalThis.fetch`.
2. `vercelRelayUrl` relay rewrite.
3. Direct `globalThis.fetch`.
4. `RuntimeCapabilityError` when proxy intent is present but no proxy transport
   is registered (`missingCapability("proxy-transport")` /
   `missingCapability("mitm-dns-bypass")`).

`open-sse/executors/base.js` `buildUrl` derives the upstream URL from
`credentials.runtimeTransport` (registry transports) or from the provider
registry base URL. `open-sse/handlers/chatCore.js:113` sets
`credentials.runtimeTransport = useTransport`.

### 1.5 Runtime composition (Local)

`src/instrumentation.js` → `src/lib/runtime/localComposition.js`
`startLocalComposition()` composes the `local-node` profile with
`httpTransport` = `globalThis.fetch`, `persistence` =
`createSqliteApiKeyRepository(database)`, `ephemeral` =
`createLocalEphemeralStore()`, `backgroundTasks` =
`createLocalBackgroundTasks()`, `scheduler` =
`createLocalIntervalScheduler()`. This runs only when
`resolveRuntimeProfile().isLocalPersistent` is true — i.e. `RUNTIME_PROFILE` in
`local-node` | `local-bun` | `docker-node`.

`open-sse/utils/proxyFetch.js` calls `registerExecutorFetch(proxyAwareFetch)`
at module scope (line 334), so in the Local process the executor egress is the
proxy-aware fetch, not raw `globalThis.fetch`.

### 1.6 PoC Worker call graph (separate, smaller)

```
POST /v1/chat/completions  (cloud-poc/src/worker.js)
  ├─ composeCloudflareRequestRuntime(...)   open-sse/runtime/adapters/cloudflareProduction.js
  │    ├─ persistence → createD1ApiKeyRepository(env.DB)
  │    ├─ ephemeral  → createD1EphemeralStore(env.DB)
  │    └─ backgroundTasks → createCloudflareBackgroundTasks({executionContext})
  ├─ translateRequest(clientFormat, OPENAI, ...)  open-sse/translator/index.js
  ├─ getExecutor("openai")                        open-sse/executors/serverless.js
  │    └─ DefaultExecutor.execute() → executorFetch()
  └─ local translateSSE / translateJSONResponse   cloud-poc/src/worker.js:50 / :20
```

FACT: the PoC Worker does **not** call `handleChat`, `handleChatCore`,
`open-sse/handlers/chatCore/streamingHandler.js`, or
`nonStreamingHandler.js`. Its SSE and JSON response shaping are local
functions in `cloud-poc/src/worker.js`. The production `handleChatCore`
request/response semantics are therefore not exercised by the PoC.

## 2. PoC-only / Local-only / hard-coded dependency inventory (AC2)

Each row records: dependency, exact evidence, and a disposition **candidate**
(the contract decision itself is 浩宇's, AC3).

`REMOVE` = must not exist in the Worker runtime. `ADAPT` = must be replaced by a
runtime-neutral port. `RETAIN` = safe to keep as-is.

### D1 — PoC-only placeholders

| # | Dependency | Exact evidence | Candidate |
|---|---|---|---|
| D1.1 | `UPSTREAM_ORIGIN` bound to loopback | `cloud-poc/wrangler.toml:9` `UPSTREAM_ORIGIN = "http://127.0.0.1:8788"`; `cloud-poc/src/worker.js:299` returns 500 `missing_upstream_origin` when unset; `cloud-poc/src/worker.js:316` `baseUrl: env.UPSTREAM_ORIGIN` | ADAPT — must become a per-connection upstream resolved from a Worker-reachable credential store |
| D1.2 | Hard-coded mock credential | `cloud-poc/src/worker.js:314` `apiKey: "mock-token"` | ADAPT — real credential resolution |
| D1.3 | Hard-coded mock model | `cloud-poc/src/worker.js:312` `model = payload.model \|\| "mock-model"` | ADAPT — real model→provider resolution |
| D1.4 | Hard-coded upstream path | `cloud-poc/src/worker.js:317` `urlSuffix: "/v1/chat/completions"` — a single fixed OpenAI path | ADAPT — registry-driven transport selection |
| D1.5 | Mock upstream server | `cloud-poc/mock-upstream.mjs` (56 lines, `node:http`, `127.0.0.1:8788`) | REMOVE from the production Worker path (test fixture only) |
| D1.6 | `VALIDATION_MODE` probe surface | `cloud-poc/wrangler.toml:8` `VALIDATION_MODE = "true"`; `cloud-poc/src/worker.js:119`; `cloud-poc/src/worker.js:280` `getExecutor("devin-cli")` probe | REMOVE from the production Worker path |
| D1.7 | Duplicated simplified response path | `cloud-poc/src/worker.js:20` `translateJSONResponse`, `cloud-poc/src/worker.js:50` `translateSSE` — reimplementations of the production handlers | ADAPT — replace with the production `chatCore` handlers |
| D1.8 | Restricted translator registry | `open-sse/translator/register-serverless.js` registers 2 unique direction pairs (`CLAUDE->OPENAI`, `OPENAI->CLAUDE`) from 4 files; `register-all.js` registers 22 unique direction pairs from 22 files. The 20 pairs missing from the serverless set include `OPENAI->OPENAI_RESPONSES`, `OPENAI->KIRO`, `CLAUDE->KIRO`, `OPENAI->GEMINI`, `OPENAI->VERTEX`, `OPENAI->ANTIGRAVITY` | ADAPT — decide the production Worker translator set |
| D1.9 | Validation-only D1 tables | `cloud-poc/migrations/0001_probe.sql`, `0004_validation_background.sql` | REMOVE from the production Worker path (`0002_api_keys.sql`, `0003_ephemeral_store.sql` are the reusable pair) |

### D2 — Local-only state in the production chat path

Every row below is **reachable from `src/app/api/v1/chat/completions/route.js`**
in the current master. Reachability chains were produced by walking the static
import graph from that entrypoint.

| # | Dependency | Exact evidence | Candidate |
|---|---|---|---|
| D2.1 | SQLite DB layer via the `open-sse/index.js` barrel | `src/sse/handlers/chat.js:1` `import "open-sse/index.js"` → `open-sse/index.js` → `open-sse/utils/stream.js:3` → `@/lib/usageDb.js` → `src/lib/db/index.js` (28 files incl. `driver.js`, `paths.js`, all `repos/*`) | ADAPT — port the persistence reads, not the driver |
| D2.2 | Provider connection store (credentials source) | `src/sse/services/auth.js:1` `getProviderConnections` from `@/lib/localDb` → `src/lib/db/repos/connectionsRepo.js` | ADAPT — a Worker-reachable credential repository |
| D2.3 | Settings store (combos, strategies, `requireApiKey`, provider overrides) | `src/lib/db/repos/settingsRepo.js` via `getSettings()` in `src/sse/handlers/chat.js` | ADAPT |
| D2.4 | API-key store + per-key access lists | `src/sse/services/keyAccess.js:24-25` imports `getApiKeyByKey` from `@/lib/db/repos/apiKeysRepo.js`, `getCombos` from `@/lib/db/repos/combosRepo.js` | ADAPT — D1 `api_keys` table + `open-sse/runtime/adapters/d1/apiKeyRepository.js` already implements the `ApiKeyRepository` port |
| D2.5 | Combo store | `src/lib/db/repos/combosRepo.js` (via `getComboModels`) | ADAPT |
| D2.6 | Model alias / provider node store | `src/sse/services/model.js` `getModelAliases`, `getProviderNodes` | ADAPT |
| D2.7 | Usage + request-detail write path | `open-sse/handlers/chatCore.js:17`, `streamingHandler.js:10`, `nonStreamingHandler.js:12`, `sseToJsonHandler.js:13`, `requestDetail.js:1`, `open-sse/utils/stream.js:3` all import `@/lib/usageDb.js` | ADAPT — Worker usage sink or explicit REMOVE of per-request writes |
| D2.8 | `thoughtSignatureStore` reaches into the Local DB layer | `open-sse/services/thoughtSignatureStore.js:1` `import { makeKv } from "../../src/lib/db/helpers/kvStore.js"`; reachable via `open-sse/executors/zed.js` → `open-sse/translator/response/gemini-to-openai.js` | ADAPT or REMOVE |
| D2.9 | `DATA_DIR` / local filesystem | `src/lib/dataDir.js` imports `node:fs`, `path`, `os`; `src/lib/db/paths.js` resolves the SQLite file under `DATA_DIR` (default `~/.9router`) | REMOVE from the Worker runtime |
| D2.10 | Local-only Node builtins in the chat path | `open-sse/executors/devin-cli.js` (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:readline`); `open-sse/translator/concerns/image.js:3-4` (`node:dns/promises`, `undici`); `open-sse/utils/proxyFetch.js:1` (`stream`); `open-sse/providers/catalogOverride.js` (`node:fs`, `node:path`); `src/lib/headroom/detect.js:1` (`child_process`); `src/lib/pxpipe/install.js:1-3` (`fs`, `path`, `child_process`) | REMOVE / ADAPT |
| D2.11 | Full Local executor registry pulled into the chat path | `open-sse/index.js` → `open-sse/executors/index.js` eagerly imports and instantiates 40 executors (see D3) | ADAPT — the serverless registry (`open-sse/executors/serverless.js`) is the Worker-safe shape |
| D2.12 | OAuth token-refresh chain reaching `src/lib/oauth/**` (43 files) | `src/sse/services/tokenRefresh.js` → `open-sse/services/oauthCredentialManager.js` → `open-sse/services/tokenRefresh/providers.js` → `src/lib/oauth/services/xai.js` → `src/lib/oauth/services/oauth.js` | ADAPT — refresh must go through a Worker-safe credential service |
| D2.13 | OAuth `open` / `chalk` / `ora` browser-launch UI | `src/lib/oauth/services/oauth.js:1` `import open from "open"`; `src/lib/oauth/utils/ui.js:1-2` `chalk`, `ora` | REMOVE from the Worker runtime |
| D2.14 | `node-machine-id` | `open-sse/shared/machineId.js:1`; reachable via `open-sse/executors/grok-cli.js` | REMOVE or ADAPT — machine identity is a Local-deployment concept |
| D2.15 | `proxyFetch` global fetch patch | `open-sse/index.js:2` `import "./utils/proxyFetch.js"` (module-scope `registerExecutorFetch(proxyAwareFetch)` at `open-sse/utils/proxyFetch.js:334`) | ADAPT — the Worker registers `globalThis.fetch` instead |
| D2.16 | In-process `setInterval` TTL timers | `open-sse/utils/sessionManager.js:22` and `:272`, both `.unref()`-guarded, lazy-init on first store write | ADAPT — Worker has no stable timers (`stable-timers` is not in the `cloudflare-worker` capability tags) |
| D2.17 | Local SQLite usage/log side files | `src/lib/usageDb.js` → `src/lib/db/index.js` → `src/lib/db/repos/usageRepo.js` | ADAPT or REMOVE |

### D3 — Executors that cannot run in the Worker

`open-sse/executors/capabilities.js` `LOCAL_EXECUTORS` lists **40** provider ids
marked `localOnly: true`:

```
antigravity azure bedrock br bedrock-xai brx gemini-cli github iflow qoder
qoder-cn kiro kimchi codex cursor cu vertex vertex-partner opencode
opencode-go opencode-zen grok-web grok-cli gcli gb perplexity-web ollama-local
commandcode xiaomi-tokenplan xiaomi-mimo mimo-free mmf codebuddy-cn
codebuddy-intl trae zed windsurf minimax-code minimax-code-global devin-cli
```

`open-sse/executors/serverless.js` `getExecutor` calls
`assertExecutorCapabilities(provider, getRuntime())` and throws
`RuntimeCapabilityError` for any of them. Every other provider resolves to
`DefaultExecutor` (`open-sse/executors/default.js`), whose only required
capability is `http-fetch`.

Candidate disposition:
- **REMOVE from the Worker bundle** (all 40 as a set).
- **ADAPT** the subset with a genuinely server-reachable upstream, e.g. `codex`,
  `github`, `iflow`, `bedrock`, `cursor` — each needs its own credential,
  signing and streaming contract. `open-sse/executors/capabilities.js` already
  encodes the mechanism (`localOnly: false` + `required: [...]`).
- **RETAIN** the registry entry on the Local side unchanged.

Note: `open-sse/executors/index.js` is reachable from the production chat path
(D2.11) and statically instantiates all 40 Local executors — this is the
single largest source of Local-only code in the production bundle.

OBSERVED graph sizes at this SHA: the production chat entrypoint reaches
**443** module files, of which **28** are `src/lib/db/*` and **43** are
`src/lib/oauth/*`. The PoC Worker entrypoint reaches **222** module files and
**zero** files under `src/lib/db/`, `src/lib/oauth/`, `src/sse/` or
`src/shared/`.

## 3. Existing durable evidence reused

| Evidence | Location | Relation to this inventory |
|---|---|---|
| Runtime capability ADR | `docs/runtime-capability-adr.md` | Defines the nine ports, the capability taxonomy, and the profile table. §7 already states "the foundation-phase available port set is only `httpTransport`". Confirms `cloudflare-worker` has `capabilityTags: ['http-fetch']` only. |
| Serverless compatibility PoC verdict | `docs/serverless-compatibility-poc.md` | Verdict `SERVERLESS_POC_CONDITIONAL`. Explicitly records that the PoC does **not** cover the full request chain, that the production executor was not in the PoC, and that `translateRequest` had no registered request pair in the PoC. Matches D1.7 / D1.8. |
| Persistence boundary acceptance | `docs/persistence-boundary-acceptance.md` | Verdict `PERSISTENCE_CONDITIONAL`; records the `ApiKeyRepository` port and the D1 / SQLite / PostgreSQL adapters. Basis for D2.4's ADAPT candidate. |
| Runtime-neutral production graph guard | `tests/unit/runtime/runtime-neutral-production-graph.test.js` | Already asserts the runtime-neutral closure of `open-sse/executors/serverless.js` and `open-sse/translator/register-serverless.js` contains no adapter, no vendor SDK, no Local-only builtin. Its declared roots do **not** include `open-sse/handlers/chatCore.js` — that is the gap this inventory closes. |
| Executor bundle boundary guard | `cloud-poc/test/executor-bundle-boundary.test.js` | Asserts the serverless executor graph excludes `src/lib/`, `proxyFetch.js`, `tokenRefresh`, `oauthCredentialManager.js`, `devin-cli.js`, and `bun:` / `node:sqlite|fs|path|child_process|dns|https|net` / `undici` / `better-sqlite3` / `sql.js`. |
| PoC test suite (this run) | `cloud-poc/test/*.test.js` | 11/11 pass (`worker.test.js`), 2/2 pass (`executor-bundle-boundary`, `translator-registry-parity`), 5/5 pass (`worker-cancel-chain`, `probe`). Observed upstream fetch, SSE translation, non-2xx passthrough, and abort chain against a local mock. |

## 4. Commands used to reproduce

```sh
cd 9router
git rev-parse HEAD                       # 60870d43ac2ea79cd42d456fafdef3968eb5b905
git rev-parse origin/master              # identical

cd cloud-poc
node --test test/worker.test.js                    # 11 pass
node --test test/executor-bundle-boundary.test.js \
         test/translator-registry-parity.test.js   # 2 pass
node --test test/worker-cancel-chain.test.js \
         test/probe.test.js                        # 5 pass
```

Static import-graph reachability was computed by walking `import` / `export … from`
/ dynamic `import()` / `require()` specifiers from
`src/app/api/v1/chat/completions/route.js` and from `cloud-poc/src/worker.js`,
resolving `@/…` to `src/…`, `open-sse/…` to the repo root, and relative
specifiers to the importing file (with `.js` / `index.js` resolution).

## 5. Open items that are NOT facts at this SHA

- Whether the Worker should own combo expansion, account fallback and OAuth
  refresh, or whether those stay behind a credential service, is a contract
  decision (AC3), not a fact of the current code.
- The exact upstream set reachable from a Worker is undetermined.
- No remote Cloudflare CPU sample exists (`docs/serverless-compatibility-poc.md`
  records `EVIDENCE_INSUFFICIENT`).
