# Cloudflare Workers Builds

9router uses one Cloudflare Worker (`9router`) and one persistent D1 database. Configure Cloudflare Workers Builds for repository `liling/9router`, branch `serverless-architecture`, root directory `cloud-poc`, build command `npm run workers:build`, and deploy command `npm run workers:deploy`. Disable Preview deployments so previews cannot create a second Worker surface.

## Cloudflare setup

- Configure `WORKERS_CI_ACCOUNT_ID` as the 32-hex account ID and `D1_DATABASE_ID` as the existing persistent D1 UUID in encrypted Workers Builds variables. `wrangler.toml` pins deployment to that account and binds the D1 as `DB`; do not create a second database.
- Set `VALIDATION_MODE=true` in Worker variables. Create a cryptographically random token with at least 256 bits of entropy using an approved secret manager directly within the Cloudflare administration flow. Store it only as Worker secret `VALIDATION_PROBE_TOKEN` and as an encrypted Workers Builds variable with the same name; never put its value in source, logs, evidence, GitHub, or a developer machine.
- Configure `VALIDATION_URL` to the exact HTTPS `workers.dev` URL emitted by deployment for `9router` in the configured account. The deploy wrapper extracts the URL from that invocation and refuses smoke if the configured URL differs. It accepts no arbitrary `workers.dev` target.
- Configure `EVIDENCE_PATH` to a writable build workspace location. Workers Builds must expose `WORKERS_CI=1`, `WORKERS_CI_BRANCH=serverless-architecture`, `WORKERS_CI_COMMIT_SHA` (40 hex characters), and a valid UUID in `WORKERS_CI_BUILD_UUID`.
- Rotate the probe token by generating a new high-entropy value in the approved Cloudflare-side secret flow, replacing both the Worker secret and encrypted Builds variable together, and then retiring the previous value. Never stage or transfer the value through a local file or chat.
- Workers Builds identity supplies Wrangler authorization. Do not configure a Cloudflare API token or GitHub deploy credential.

## Build and deploy behavior

`workers:build` validates identity, account, and persistent D1 settings before running locked `npm ci`, tests, Wrangler dry-run, and syntax checks. It invokes no remote Wrangler mutations. `workers:deploy` additionally gates on build UUID, URL, and credential strength; applies checked-in migrations remotely, deploys `9router`, verifies the emitted URL matches the configured target, then runs smoke against that exact deployed Worker.

The smoke uses a unique run suffix and attempts exact cleanup after all probes, including after partial failures. It reports per-table cleanup outcomes for `api_keys`, ephemeral probe/isolation/context rows, and `validation_background`. The evidence includes SHA, build UUID, branch, Worker/target, migration/deploy/smoke results, timestamps, profile and ingress/port truth. Executor/chat remains `not tested` because upstream is loopback; Scheduler remains unavailable; waitUntil remains best-effort and non-durable. No additional Worker or D1 is created or deleted. Local Node is the CI control; Cloud Run, Vercel, and Bun remain readiness-only.

## Validation plan

1. Run `npm ci`, `npm test`, and `npm run build` from `cloud-poc`.
2. Test wrong/missing Workers Builds identity, account/D1 configuration, UUID, target URL, and low-entropy credential values; confirm rejection occurs before commands.
3. Assert deploy ordering is remote migrations, deploy, then smoke, and that smoke receives only the URL parsed from that deploy invocation.
4. Exercise exact synthetic-row cleanup, including partial-failure retry and per-table evidence; review evidence for truthful target/profile/port and secret-free output.
5. Human acceptance and Cloudflare dashboard configuration are required before any remote deployment. No remote deployment is triggered by local validation.
