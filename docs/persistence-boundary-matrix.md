# Persistence boundary verification matrix

Run the persistence matrix after installing the test and application dependencies:

```sh
cd tests
npm ci
npm run test:persistence
```

The runner covers all three adapters:

| Adapter | Verification | Storage |
| --- | --- | --- |
| SQLite | `unit/runtime/persistence/sqlite-api-key-repository.test.js` | Real SQLite adapter under the Node test seam |
| D1 | `cloud-poc/test/d1-workerd-e2e.test.js` | Local D1 migrations under Workerd, through the test-only Worker entrypoint |
| PostgreSQL | `unit/runtime/persistence/postgres-api-key-repository.contract.test.js` | Ephemeral PostgreSQL 16 Docker container |

SQLite and PostgreSQL run the shared `apiKeyRepositoryContract`, including disjoint concurrent patch preservation. The Workerd/D1 test exercises the corresponding behaviors against local D1 and also checks the deployable Worker rejects all unauthenticated API-key probe operations.

The `tests` package lock installs Vitest, not the root application's runtime dependencies. The PostgreSQL adapter imports the root-declared `pg` package, and some unrelated application tests import root-declared `uuid`. The root project has no lockfile, so `cd tests && npm ci` alone cannot provision those packages. Install the root application dependencies using the workspace's supported package-manager setup before running the matrix. In the acceptance run, root dependencies were provisioned without creating a lockfile; the initial missing-`pg` resolution failure was corrected before the persistence suite was accepted.
