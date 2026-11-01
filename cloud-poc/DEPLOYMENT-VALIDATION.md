# Cloudflare Workers Builds

9router uses one Cloudflare Worker (`9router`) and one persistent D1 database. Configure Cloudflare Workers Builds for repository `liling/9router`, branch `serverless-architecture`, root directory `cloud-poc`, build command `npm run workers:build`, and deploy command `npm run workers:deploy`. Disable Preview deployments so previews cannot create a second Worker surface.

## Cloudflare setup

- Bind the existing persistent D1 database as `DB`, database name `9router`, and configure the matching `D1_DATABASE_ID` build variable. Keep that identifier in Cloudflare settings, not source control.
- Apply the checked-in `migrations/` to that database through the guarded deploy command before deployment.
- Set `VALIDATION_MODE=true` in Worker variables and configure `VALIDATION_PROBE_TOKEN` as a secret on the Worker and as an encrypted Workers Builds variable for post-deploy smoke checks. Never put its value in config, logs, evidence, GitHub, or a developer machine.
- Configure `VALIDATION_URL` to the HTTPS `workers.dev` URL for `9router` and `EVIDENCE_PATH` to a writable build workspace location.
- Workers Builds must expose `WORKERS_CI=1`, `WORKERS_CI_BRANCH=serverless-architecture`, `WORKERS_CI_COMMIT_SHA` (40 hex characters), and `WORKERS_CI_BUILD_UUID`.
- Workers Builds identity supplies Wrangler authorization. Do not configure a Cloudflare API token or GitHub deploy credential.

## Build and deploy behavior

`workers:build` validates the build identity before running locked `npm ci`, tests, Wrangler dry-run, and syntax checks. It does not invoke remote Wrangler mutations. `workers:deploy` validates the same identity, applies the checked-in D1 migrations remotely, deploys `9router`, and runs the smoke script against that same Worker. Validation rows use synthetic `validation:` keys and the persistence probe deletes its row after reading it. No additional Worker or D1 is created or deleted.

The smoke records the commit SHA, build UUID, branch, sanitized target, timestamps, profile, ingress/port truth, outcome names, Scheduler state, and explicitly marks executor/chat `not tested` because the upstream is loopback. Logs and evidence must contain no secret values. Scheduler remains unavailable; waitUntil is best-effort and non-durable. Local Node is the CI control; Cloud Run, Vercel, and Bun remain readiness-only.

## Validation plan

1. Run `npm ci`, `npm test`, and `npm run build` from `cloud-poc`.
2. Test wrong/missing Workers Builds identity values and confirm rejection occurs before command execution.
3. Assert deploy ordering is remote migrations, Worker deploy, then remote smoke.
4. Review build evidence for commit/build identity, target, outcome truth, profile, timestamps, and secret-free output.
5. Human acceptance and Cloudflare Environment/Worker configuration are required before any remote deployment. No remote deployment is triggered by local validation.
