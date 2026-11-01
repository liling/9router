import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cleanupValidationRows } from "./validation-cleanup.mjs";

const baseUrl = process.env.VALIDATION_URL;
const runId = process.env.WORKERS_CI_BUILD_UUID;
const sha = process.env.WORKERS_CI_COMMIT_SHA;
const evidencePath = process.env.EVIDENCE_PATH;
const probeToken = process.env.VALIDATION_PROBE_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const deployedUrl = process.env.WORKERS_CI_DEPLOYED_URL;
if (!baseUrl || !/^[a-f0-9]{40}$/i.test(sha || "") ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId || "") ||
    !/^[a-f0-9]{32}$/i.test(accountId || "") || !evidencePath || !/^(?:[a-f0-9]{2}){32,}$/i.test(probeToken || "") || !deployedUrl) {
  throw new Error("Validation evidence configuration is incomplete");
}
const origin = new URL(baseUrl);
const deployedOrigin = new URL(deployedUrl);
if (origin.protocol !== "https:" || !/^9router\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) ||
    origin.origin !== deployedOrigin.origin || deployedOrigin.protocol !== "https:") {
  throw new Error("Refusing a target that does not match the deployed 9router Worker identity");
}

const startedAt = new Date().toISOString();
const results = {};
let observedProfile = "unknown";
async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      "x-validation-token": probeToken,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let json = {};
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

async function check(name, action) {
  try {
    await action();
    results[name] = "PASS";
  } catch {
    results[name] = "FAIL";
  }
}

await check("worker-health", async () => {
  const result = await request("/health");
  if (result.status !== 200 || result.json.runtime !== "worker" || !result.json.profile) throw new Error("Worker health probe failed");
  observedProfile = result.json.profile;
});

const suffix = `${runId}-${crypto.randomUUID()}`;
const key = `validation:${suffix}`;
const value = `non-secret:${suffix}`;
const cleanupByTable = {
  api_keys: "not-observed",
  ephemeral_probe: "not-observed",
  ephemeral_isolation: "not-observed",
  ephemeral_context: "not-observed",
  validation_background: "not-observed",
};
await check("d1-persistence-across-requests", async () => {
  const write = await request("/probe/validation/persistence", { method: "POST", body: { key } });
  const read = await request(`/probe/validation/persistence/${encodeURIComponent(key)}`);
  const afterCleanup = await request(`/probe/validation/persistence/${encodeURIComponent(key)}`);
  if (write.status !== 200 || !write.json.written || read.status !== 200 || read.json.record?.key !== key ||
      read.json.deleted !== true || afterCleanup.status !== 404) {
    throw new Error("D1 persistence probe failed");
  }
});

await check("ephemeral-namespace-isolation", async () => {
  const namespaceA = `validation-a-${suffix}`;
  const namespaceB = `validation-b-${suffix}`;
  const put = await request("/probe/validation/ephemeral", {
    method: "POST", body: { namespace: namespaceA, key: suffix, value },
  });
  const found = await request(`/probe/validation/ephemeral/${namespaceA}/${suffix}`);
  const isolated = await request(`/probe/validation/ephemeral/${namespaceB}/${suffix}`);
  if (put.status !== 200 || found.status !== 200 || found.json.value !== value || isolated.status !== 404) {
    throw new Error("D1 ephemeral namespace isolation probe failed");
  }
});

await check("waituntil-best-effort", async () => {
  const id = `validation:${suffix}`;
  const enqueue = await request("/probe/validation/background", { method: "POST", body: { id } });
  if (enqueue.status !== 200 || enqueue.json.durable !== false) throw new Error("waitUntil enqueue probe failed");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = await request(`/probe/validation/background/${encodeURIComponent(id)}`);
    if (status.status === 200 && status.json.completed && status.json.durable === false) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("waitUntil task did not complete within the validation window");
});

await check("concurrent-request-context-isolation", async () => {
  const calls = Array.from({ length: 12 }, (_, index) => {
    const requestId = `${suffix}-${index}`;
    const requestValue = `value-${index}`;
    return request("/probe/validation/context", {
      method: "POST", body: { requestId, value: requestValue },
    }).then(({ status, json }) => ({ status, json, requestId, requestValue }));
  });
  const responses = await Promise.all(calls);
  if (responses.some(({ status, json, requestId, requestValue }) =>
    status !== 200 || json.requestId !== requestId || json.value !== requestValue || json.profile !== "cloudflare-worker")) {
    throw new Error("Concurrent request context probe failed");
  }
});

await check("missing-binding-fails-closed", async () => {
  const result = await request("/probe/validation/missing-binding");
  if (result.status !== 200 || result.json.failClosed !== true) throw new Error("Missing D1 binding did not fail closed");
});

await check("scheduler-unavailable", async () => {
  const result = await request("/probe/validation/scheduler");
  if (result.status !== 404) throw new Error("Scheduler unexpectedly appeared available");
});

await check("synthetic-d1-cleanup", async () => {
  const cleanup = await cleanupValidationRows(request, suffix);
  Object.assign(cleanupByTable, cleanup.outcomes);
  results["synthetic-d1-cleanup-by-table"] = cleanupByTable;
  if (!cleanup.ok) throw new Error("Synthetic D1 cleanup was incomplete");
});

const evidence = {
  sha,
  runId,
  buildId: runId,
  branch: process.env.WORKERS_CI_BRANCH,
  worker: "9router",
  target: origin.hostname,
  startedAt,
  completedAt: new Date().toISOString(),
  profile: observedProfile,
  ingress: "HTTPS workers.dev; no fixed application port",
  scheduler: "unavailable",
  executorChat: "not tested; configured loopback upstream is not edge reachable",
  secretFreeLogs: "validation script emits outcomes only; no credentials or provider logs collected",
  outcomes: results,
};
evidence.outcomes.migrations = process.env.MIGRATIONS_RESULT || "not-observed";
evidence.outcomes.deploy = process.env.DEPLOY_RESULT || "not-observed";
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (Object.values(results).some((result) => result === "FAIL")) process.exitCode = 1;
