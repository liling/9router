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

## Baseline differential

The checked-in `tests/__baseline__/known-fails.txt` contains 24 known test identities. The accompanying historical `baseline-results.json` is not an exact differential oracle for this checkout: it records 209 suites / 26 failed tests, while the current full Vitest run collected 1,198 suites / 3,824 tests and reported 117 failures. Of those current failing test identities, 14 match the 24-item known-failure list, 10 listed failures now pass, and 103 failures are not in that list. Therefore the full-corpus differential is not clean; this PR does not claim those additional failures are pre-existing or caused by persistence. They are outside the reviewed persistence scope and require baseline reconciliation before an unconditional pass.

The root dependency limitation was not silently skipped. After `cd tests && npm ci`, the persistence suite initially could not resolve root `pg`. The root project has no lockfile; application dependencies were provisioned with `npm install --no-save --package-lock=false --ignore-scripts`, after which all persistence and focused guards passed. This also supplied root `uuid` for application tests. No package lock was generated or modified.

The conditional verdict is limited to this unresolved full-corpus differential. It is not a claim that the 103 unmatched failures are baseline failures. Human Acceptance and any later merge from `runtime/persistence-boundary` to `serverless-architecture` remain separate gates.
