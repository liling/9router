# PostgreSQL API-key persistence

The PostgreSQL adapter is server-only and owns one `pg.Pool` per repository instance. Create the repository once per Node process or warm function instance, reuse it across requests, and call `close()` during an orderly process shutdown. Do not create a pool per request. The adapter defaults to at most two connections; configure a lower value when the runtime or database proxy has a smaller per-instance budget.

## Cloud Run

Use one process-scoped repository per container instance. Set the pool maximum against the deployment's total connection budget:

`maximum instances × pool max + migration/admin connections <= database connection limit`

Cloud Run concurrency can share the pool; raise its maximum only when the database budget permits. Close the pool from the server's graceful shutdown path. Keep migration execution separate from request startup.

## Vercel

Use a lazy, module-scoped repository so warm invocations reuse the pool. Configure `max: 1` per function instance and connect through the provider-supported pooled/serverless endpoint when one is available. Account for concurrent function instances multiplying that limit. Do not open connections during build, and do not rely on a shutdown hook for correctness; serverless instances can be reclaimed without one.

## Contract verification

The focused Vitest contract suite starts an ephemeral `postgres:16.15-alpine` container with disposable local credentials, applies `schema.sql`, and runs the same shared API-key repository contract used by the other adapters. It requires Docker and does not read production database credentials. Install the application dependencies from the repository root first so the adapter can resolve `pg`:

```sh
cd tests
npm ci
npx vitest run unit/runtime/persistence/postgres-api-key-repository.contract.test.js
```

The application dependency installation must include the root `pg` dependency. Docker removes the temporary database container when the test finishes.
