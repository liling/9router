# Runtime Capability Architecture

Status: accepted for the Phase 2 foundation. Scope is the runtime-neutral contract and profile data; production adapters and business migrations remain later work.

## 1. Model and boundaries

`9router Core -> Capability Ports -> Runtime Composition -> Runtime Adapters`

A capability tag describes a runtime fact and is used for matching. A port is a fixed contract the Core can call. A runtime descriptor is immutable data; a profile plus its injected adapters forms the runtime composition. Deployment entry points are composition roots and install the resulting context once. The Core imports only port contracts and the context/capability APIs; it must not import adapters, vendor SDKs, Local-only builtins, or profile modules directly. Profiles contain data, never SDK imports. This is not a service locator: the nine ports are closed and adapters are passed to the composition root, never resolved by name at runtime.

Do not wrap Web `Request`, `Response`, `Headers`, `URL`, or streams. `HttpTransport.fetch` accepts and returns the platform Web values directly.

## 2. Stable capability taxonomy

The closed v1 tag set is `http-fetch`, `http-proxy`, `mitm-dns`, `h2-duplex`, `node-stream`, `fs-persistent`, `fs-ephemeral`, `process-spawn`, `local-socket`, and `stable-timers`. Tags are runtime facts, not vendor names. During migration, `proxy-transport -> http-proxy`, `mitm-dns-bypass -> mitm-dns`, `node-fs -> fs-persistent`, and `child-process -> process-spawn` are recognized aliases. New capability tags require an ADR change.

## 3. Runtime descriptor

`RuntimeDescriptor` is frozen pure data: stable kebab-case `id`, display `label`, `kind`, `runtimeFamily`, lifecycle model and shutdown/cold-start flags, single/multi scale and sticky-session semantics, filesystem importability/writability/durability and optional scope (`request` or `instance`, defaulting to `instance`), background model/response-survival/durability semantics, capability tags, and an availability declaration for each port. HTTP transport, persistence, and ephemeral ports additionally state whether they are authoritative; ephemeral storage states whether it is shared. `isServerless` is deliberately absent. Descriptor validation rejects incomplete structures and unknown tags. `bounded-waituntil` requires `survivesResponse: true`; background durability is always explicit.

`ports.<id>.available: true` means that a real in-repository adapter exists in this phase and the profile's composition must supply it. This is a composition contract, not an indication that an API could be imported or that an adapter is planned. An available port without an adapter, or an adapter supplied for an unavailable port, fails composition. Future work is recorded separately as `ports.<id>.planned: { adapter, authoritative?, shared?, note }`; planned metadata is documentation only and is ignored by composition and capability matching. `capabilityTags` continue to describe environment facts, independently of which ports this phase implements.

## 4. Nine capability ports

- `HttpTransport`: `fetch(url, options, proxyOptions?) -> Response`; supports direct, proxy, or relay behavior without wrapping Web APIs.
- `Repository`: asynchronous aggregate CRUD (`get`, `list`, `create`, `update`, `delete`). Its contract remains async even when a local adapter wraps synchronous SQLite.
- `EphemeralStore`: `get`, `set(key, value, { ttlMs })`, `delete`, and atomic `consume(key)` for OAuth state, PKCE, nonce, and similar short-lived data.
- `LeaseStore`: `acquire(key, { ttlMs, ownerId }) -> lease | null`, `renew`, and `release`; multi-instance profiles require distributed semantics.
- `SecretProvider`: `getSecret(name)`; Core must not add long-lived secret caches.
- `BackgroundTasks`: `enqueue({ id, execute, note? }) -> void` is fire-and-forget; callers must not await it, platform pressure may drop the task, and `execute` must not perform authoritative state transitions. Credential refresh remains lazy-on-read.
- `Scheduler`: `schedule({ id, cron, handlerId }) -> void`. Config-declared platforms (Cloudflare Cron Triggers and Vercel Cron) validate that the id is declared and cron matches, otherwise throw `RUNTIME_CAPABILITY_UNAVAILABLE`; local runtimes dynamically register via `setInterval`. There is no `cancel` or `list` method.
- `Blob`: `put`, `get`, and `delete` for byte/stream payloads. Missing capability means an explicit disabled or explicit no-cache behavior.
- `Process/CLI/Socket` (optional, local-only): `spawn`, `machineIdentity`, and `localSocketReachable`.

### API-key persistence refinement (Phase 3A, PR-A)

The first production aggregate selected for migration is API keys. Its application-facing `ApiKeyRepository` is a Promise-based domain port, not the generic `Repository` CRUD facade. It exposes `findById(id)`, `findByKey(key)`, `list()`, `insert(record)`, `update(record)`, and `delete(id)`. `list` is ordered by `createdAt` ascending with stable tie ordering. Inserts reject duplicate identifiers or keys with `PersistenceConflictError`; updating a missing identifier rejects with `PersistenceNotFoundError`; deleting a missing identifier returns `false`. Lookups return a domain record or `null`.

`ApiKeyRecord` consists of `id`, `key`, `name`, nullable `machineId`, boolean `isActive`, ISO-8601 `createdAt`, and `access: { restricted, allow }`. SQL rows, column conversions, statements, drivers, and transaction callbacks remain adapter details. This contract does not define transactions or backend/runtime branching. The API key itself remains sensitive stored data; this refinement does not introduce SecretProvider migration. SQLite/D1/Postgres adapters and consumer migration remain subsequent lanes; adapter existence alone must not imply profile persistence availability.

## 5. Errors, authority, and dependency rules

`RuntimeCapabilityError` is the explicit error contract with `code`, `capability`, `runtime`, and optional `subject`. Codes are `RUNTIME_CAPABILITY_UNAVAILABLE`, `RUNTIME_PORT_UNAVAILABLE`, and `RUNTIME_CONTEXT_NOT_INSTALLED`; its legacy executor constructor remains compatible during migration. No silent fallback is allowed: ephemeral storage cannot become an in-memory Map, proxy settings cannot be discarded, and a dropped best-effort task must never be treated as authoritative completion.

Tokens, usage, connections, settings, and API keys are authoritative state. They may only use a port declared `authoritative: true`; process memory, temporary files, and timers that must happen to fire are not authoritative. Runtimes without reliable timers must refresh credentials lazily on read.

Core/Application depends on ports. Adapters may depend on vendor/runtime SDKs. Core must not import adapters, vendor packages, or Local-only builtins such as `node:fs`, `node:child_process`, or `node:dns`; profile data must not import SDKs. Worker bundle-boundary checks remain in force.

## 6. Composition and context

`composeRuntime(profileId, adapters)` builds a frozen context from profile data and a closed port set. `installRuntime(ctx)` is called by a composition root. `getRuntime()` returns that context or throws `RUNTIME_CONTEXT_NOT_INSTALLED`. Context exposes `descriptor`, `hasCapability(tag)`, and `assertPort(portId, { authoritative })`. A supplied adapter for an unavailable port, or a missing adapter for an available port, is rejected explicitly. A new port requires an ADR update.

## 7. Profiles and capability semantics

“Importable” is not the same as “authoritative.” These profiles encode API/runtime semantics, not a guarantee that an adapter is implemented in this foundation.

| Profile | Kind / family | Lifecycle; scale | Filesystem | Background | Important capabilities and authority |
|---|---|---|---|---|---|
| `local-node` | process / node | long-lived; single | persistent, durable | process timers; survives response, durable | proxy, MITM DNS, h2, Node streams, spawn/socket, stable timers; planned DB and single-instance ephemeral adapters can be authoritative |
| `docker-node` | container / node | long-lived; single profile | volume-backed, durable only on mounted volume | process timers; survives response, durable | Shares Node adapter family with Cloud Run but is a separate profile; local process/socket and stable timers |
| `cloud-run` | container / node | instance-restart; multi | filesystem importable but ephemeral and non-authoritative | process timers; no response-survival guarantee, non-durable | Node networking and h2; no `stable-timers` claim under request-based CPU; billing-mode profiles remain planned |
| `vercel-node` | function / node | function-scoped; multi | importable but ephemeral and non-authoritative | bounded waitUntil; continues after response within platform bounds, non-durable | fetch/Node streams; outbound proxy requires explicit relay adapter |
| `cloudflare-worker` | isolate / workerd | isolate-scoped; multi | under `nodejs_compat`, request-scoped ephemeral writable filesystem; non-durable | bounded waitUntil; HTTP-trigger work can continue after response for a bounded period (currently up to about 30 seconds), non-durable | Web fetch; D1/KV/R2 are planned async external adapters, not local filesystem |
| `local-bun` | process / bun | long-lived; single | persistent, durable | process timers; survives response, durable | Local profile retained for Phase 1 smoke compatibility |

For every profile above, the **foundation-phase available port set is only `httpTransport`**, with `authoritative: true`; the other ports are unavailable until their actual adapters are delivered. The persistence endpoints and local adapters described as planned in the table are target-state annotations, not current availability. BackgroundTasks and Scheduler are independent ports: bounded waitUntil is not a durable scheduler, and credential refresh uses lazy-on-read. The Cloudflare filesystem claim assumes `nodejs_compat` and a compatibility date with Node filesystem support; its request-scoped virtual filesystem is not shared across requests and must not be used as an authoritative foundation. The `fs-ephemeral` tag decision is deferred because the compatibility-date assumption is explicit profile data, not a general Cloudflare guarantee.

Docker and Cloud Run share `runtimeFamily: node`, not lifecycle, scale, filesystem, or authority semantics. Vercel remains its own Node function profile. Cloudflare decisions use current compatibility semantics and distinguish importability from authoritative suitability rather than relying on an obsolete “no Node APIs” rule.

## 8. MEM-438 alignment and architecture checks

The executor capability tags map into this taxonomy through the legacy aliases above. `executorFetch` is the first `HttpTransport` implementation; `registerExecutorFetch` is the adapter installation seam. The Worker entry remains a composition root and owns profile/adapter composition. These changes preserve the Phase 1 behavior while avoiding a second permanent capability model. A generalized static import-graph test must prevent Core dependencies on adapters, vendor packages, and Local-only builtins while preserving the Worker bundle boundary.

## 9. Migration plan

1. Persistence: define async repository contracts, wrap current SQLite repositories without behavior changes, then add D1/Postgres adapters.
2. Ephemeral state: migrate OAuth state, PKCE, nonce, and session state to `EphemeralStore`; only permit a Map adapter for single-instance profiles.
3. Background: move refresh and quota work to `BackgroundTasks`/`Scheduler`; prefer lazy-on-read refresh where timers are not reliable.
4. Secrets/config: migrate DB settings and environment lookups to `SecretProvider` without Core-side long caching.
5. Runtime compositions: deliver Cloud Run, Vercel, and Cloudflare adapters as separate follow-on tasks.
6. Extract a Runtime Kit only after at least two non-local profiles run in production, the port API remains stable for two releases, and a second consumer outside 9router exists. Do not create a package in this phase.

## 10. Future extraction boundary

The reusable candidates are `ports/`, capability matching/error contracts, and runtime context. Vendor adapters and application-specific composition remain in 9router unless a later decision proves they are independently reusable.
