# Persistence boundary verification matrix

From a clean checkout, use Node.js 20 or newer and Docker (the PostgreSQL
contract starts an ephemeral PostgreSQL 16 container). Install each package's
dependencies before running the matrix:

```sh
cd tests
npm ci
cd ../cloud-poc
npm ci
cd ..
# The root has no lockfile; these root runtime dependencies are needed by
# adapter/application tests. Do not create or commit a root lockfile for this.
npm install --no-save --package-lock=false --ignore-scripts pg uuid
cd tests
npm run test:persistence
```

The runner covers all three adapters:

| Adapter | Verification | Storage |
| --- | --- | --- |
| SQLite | `unit/runtime/persistence/sqlite-api-key-repository.test.js` | Real SQLite adapter under the Node test seam |
| D1 | `cloud-poc/test/d1-workerd-e2e.test.js` | Local D1 migrations under Workerd, through the test-only Worker entrypoint |
| PostgreSQL | `unit/runtime/persistence/postgres-api-key-repository.contract.test.js` | Ephemeral PostgreSQL 16 Docker container |

SQLite and PostgreSQL run the shared `apiKeyRepositoryContract`, including disjoint concurrent patch preservation. The Workerd/D1 test exercises the corresponding behaviors against local D1 and also checks the deployable Worker rejects all unauthenticated API-key probe operations.

The `tests` package lock installs Vitest, not the root application's runtime
dependencies. The PostgreSQL adapter and some application tests resolve root
`pg` and `uuid`, respectively. The root has no lockfile, so `tests` and
`cloud-poc` installs do not provision them; the command above installs these
two needed packages without creating a root lockfile. `cloud-poc npm ci` is
also required because its Workerd test invokes Wrangler from its local
development dependencies.
