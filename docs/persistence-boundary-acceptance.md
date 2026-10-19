# Persistence boundary integration acceptance

Verdict: `PERSISTENCE_BOUNDARY_CONDITIONAL`

The reviewed delivery units composed on `runtime/persistence-boundary` in the approved order. No source semantics, profile availability, or consumers were changed during integration.

## Composition readbacks

| Step | Source | Resulting integration SHA |
| --- | --- | --- |
| Base | `runtime/persistence-boundary` | `cc544c470c84b20f4dd4643d69ee5c0d73c7fe7e` |
| A | `runtime/persist-contract` / PR #17 | `35bd8f4b2947ffab1d5d785e58b8938aaa558335` |
| B | `runtime/persist-sqlite` / PR #19 | `55c3d8811538ce12afabcf4a3e30ebe4a930b442` |
| C | `runtime/persist-d1` / PR #18 | `fd4cb7f0b7d203f97960d8311728b0214e1a3cfe` |
| D | `runtime/persist-postgres` / PR #20 | `0098a698e85851aed937288f5e3abe3df491b00b` |

Each value was pushed and read back from the integration ref before proceeding to the next unit. PRs #19, #18, and #20 were retargeted to `runtime/persistence-boundary`; no PR was merged into `serverless-architecture`.

## Verification evidence

- `cd tests && npm ci && npx vitest run unit/runtime/persistence/`: passed, 4 files / 18 tests, including the shared SQLite/PostgreSQL contract suites and vendor-boundary check.
- PostgreSQL contract: passed against ephemeral Docker PostgreSQL 16; includes `update(id, patch)`, conflict/not-found behavior, immutable fields, null clearing, and concurrent disjoint patches.
- `cd cloud-poc && npm ci && node --test`: passed, 12/12, including local Workerd/D1 contract checks and unauthenticated probe rejection against the deployable Worker.
- Runtime graph/dependency, executor, and profile-truth guards: passed, 15/15. The production graph includes the deployable Worker and API-key service roots; it rejects reachability into SQLite/D1/PostgreSQL adapters and their vendor drivers. Every runtime profile still marks persistence unavailable and planned.
- `git diff --check`: passed for the PR-E diff.

## Same-environment full-suite differential

The differential compares the accepted base `cc544c470c84b20f4dd4643d69ee5c0d73c7fe7e`
with final integration `13dcacb2bf127437e8d96e71c56ea81fbf174193`. Both clean
detached worktrees used Node.js `v24.21.0` and npm `12.2.0`. Dependencies were
installed identically with `cd tests && npm install --package-lock=false --ignore-scripts`
and, at repository root, `npm install --no-save --package-lock=false --ignore-scripts`.
The identical full-suite command was
`npm exec -- vitest run --reporter=json --outputFile=<report-path>`.

| Revision | Tests | Failed | Pending |
| --- | ---: | ---: | ---: |
| Accepted base | 3,806 | 115 | 98 |
| Final integration | 3,824 | 115 | 98 |

The failed-test identity sets match: base-only 0, final-only 0, and current-only
failures 0. The raw Vitest JSON reports are retained in
`tests/artifacts/persistence-differential/`. Reconcile them with
`node tests/compare-vitest-reports.mjs tests/artifacts/persistence-differential/base-vitest.json tests/artifacts/persistence-differential/final-vitest.json`.

This establishes no newly failing test identity in the final integration; it
does not claim that the existing 115 failures pass or establish their cause.
Human Acceptance and any later merge from `runtime/persistence-boundary` to
`serverless-architecture` remain separate gates.
