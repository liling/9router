# Cloudflare deployment validation plan

## Scope and controls

`.github/workflows/cloudflare-deployment-validation.yml` is manual-only. It can
run only from `serverless-architecture`, requires the explicit Human Acceptance
input, and uses the `cloudflare-validation` GitHub Environment. Configure that
Environment with required reviewers before enabling it. No workflow run or
Cloudflare deployment is authorized before Human Acceptance.

Configure these Environment values through GitHub settings, never issue/chat:

- Secret `CLOUDFLARE_API_TOKEN` with account-scoped D1 Read/Write and Workers
  Scripts Read/Write permissions.
- Variable `CLOUDFLARE_ACCOUNT_ID` for the dedicated non-production test account.

The workflow fails before resource creation if either value is absent/invalid.
It creates a unique `9router-mem475-validation-<run>-<attempt>` D1 database and
Worker, enables only `workers.dev`, binds no custom domain/route, and uses the
existing Worker composition. Probe routes require a random per-run credential
held only in runner temporary storage and the validation Worker variables;
production mode hides those routes. `UPSTREAM_ORIGIN` remains loopback and is never
used as evidence of remote chat/executor reachability. Scheduler remains
unavailable. No production DNS, account switching, or local-machine deploy is
part of this plan.

Preflight refuses any existing exact generated name. Cleanup addresses only
the generated Worker name and the D1 UUID returned by that run; cleanup runs
with `always()` after resource provisioning begins. If cleanup fails, the job
fails and sanitized evidence records that result for human follow-up. The
workflow does not emit Wrangler migration/deploy logs, raw API responses,
request payloads, or credential values. Only the sanitized evidence JSON is
uploaded.

## Automated plan

1. On the exact workflow commit, install `cloud-poc/package-lock.json`, run the
   existing local Workerd/control tests, and run the Wrangler dry-run build.
2. Verify the accepted base is an ancestor of the dispatched commit.
3. Preflight unique Worker/D1 names, create isolated D1, apply the checked-in
   migrations, and deploy the Worker with `VALIDATION_MODE=true`.
4. Exercise persistence across separate HTTP requests; prove D1 ephemeral
   namespace isolation; verify concurrent request-context responses; wait for
   a best-effort `waitUntil` D1 write while reporting it as non-durable; and
   verify the missing-D1 composition path fails closed.
5. Confirm health reports the Worker profile; verify Scheduler remains
   unavailable. The application ingress is HTTPS `workers.dev` and has no
   fixed application port. Do not test remote chat/executor traffic against
   the configured loopback upstream.
6. Record SHA, run URL/ID, sanitized target, outcome names, timestamps, profile,
   ingress/port truth, scheduler state, and cleanup result. Do not collect
   Cloudflare provider logs; the probe handlers do not log request data or
   credential material.
7. Always attempt exact-target cleanup after creation/deployment, including
   failed smoke checks. Confirm cleanup outcome from the sanitized artifact.

## Controls outside this workflow

Local Node production-composition tests remain the CI control. Docker is only a
packaged Local Node control if separately run. Cloud Run, Vercel Node, and Bun
remain readiness-only; this workflow makes no claims about them.
