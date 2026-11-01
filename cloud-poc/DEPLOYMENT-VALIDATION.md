# Cloudflare Workers Builds

9router uses one Cloudflare Worker (`9router`) and one persistent D1 database. Configure Cloudflare Workers Builds for repository `liling/9router`, branch `master`, root directory `cloud-poc`, build command `npm run workers:build`, and deploy command `npm run workers:deploy`. Disable Preview deployments so previews cannot create a second Worker surface.

## Cloudflare setup

- Configure the existing persistent D1 UUID as the Cloudflare Workers Builds `D1_DATABASE_ID` environment variable. Wrangler receives a temporary config generated from this concrete UUID; no D1 ID placeholder or account interpolation is committed.
- Use Workers Builds' native `CLOUDFLARE_ACCOUNT_ID` / account context for Wrangler account selection. Do not set a custom Wrangler `account_id` field or configure a Cloudflare API token.
- Set `VALIDATION_MODE=true` in Worker variables. Create a cryptographically random token with at least 256 bits of entropy using an approved secret manager directly within the Cloudflare administration flow. Store it only as Worker secret `VALIDATION_PROBE_TOKEN` and as an encrypted Workers Builds variable with the same name; never put its value in source, logs, evidence, GitHub, or a developer machine.
- Configure `VALIDATION_URL` to the exact HTTPS `workers.dev` URL emitted by deployment for `9router` in the configured account. The deploy wrapper extracts the URL from that invocation and refuses smoke if the configured URL differs.
- Configure `EVIDENCE_PATH` to a writable build workspace location. Workers Builds must expose `WORKERS_CI=1`, `WORKERS_CI_BRANCH=master`, `WORKERS_CI_COMMIT_SHA` (40 hex characters), and a valid UUID in `WORKERS_CI_BUILD_UUID`.
- Rotate the probe token by generating a new high-entropy value in the approved Cloudflare-side secret flow, replacing both the Worker secret and encrypted Builds variable together, and then retiring the previous value. Never stage or transfer the value through a local file or chat.
- Workers Builds identity supplies Wrangler authorization. No GitHub deploy credential or second Worker/D1 is used.

## Build and deploy behavior

`workers:build` validates Workers Builds identity, native account context, and D1 UUID before running locked `npm ci`, tests, Wrangler dry-run, and syntax checks. The dry-run uses the same temporary Wrangler config generator as deploy and performs no remote mutation. `workers:deploy` additionally gates on build UUID, URL, and credential strength; generates one temporary config with the concrete D1 UUID; uses that same file for remote migrations and deploy; verifies the emitted URL; then runs smoke against that exact Worker. The temporary config is removed after completion.

The smoke uses a unique run suffix and attempts exact cleanup after all probes, including after partial failures. It reports per-table cleanup outcomes for `api_keys`, ephemeral probe/isolation/context rows, and `validation_background`. Evidence includes SHA, build UUID, branch, Worker/target, migration/deploy/smoke outcomes, timestamps, profile and ingress/port truth. Executor/chat remains `not tested` because upstream is loopback; Scheduler remains unavailable; waitUntil remains best-effort and non-durable. Local Node is the CI control; Cloud Run, Vercel, and Bun remain readiness-only.

## Validation plan

1. Run `npm ci`, `npm test`, and `npm run build` from `cloud-poc`.
2. Test wrong/missing Workers Builds identity, native account/D1 configuration, UUID, target URL, and low-entropy credential values; confirm rejection occurs before commands.
3. Assert generated Wrangler config contains one concrete valid D1 UUID and no environment interpolation, and that migration/deploy use the exact same config path.
4. Exercise exact synthetic-row cleanup, including partial-failure retry and per-table evidence; review evidence for truthful target/profile/port and secret-free output.
5. Human acceptance and Cloudflare dashboard configuration are required before any remote deployment. No remote deployment is triggered by local validation.
