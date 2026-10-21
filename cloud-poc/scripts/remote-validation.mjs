import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const baseUrl = process.env.VALIDATION_URL;
const runId = process.env.GITHUB_RUN_ID;
const sha = process.env.GITHUB_SHA;
const evidencePath = process.env.EVIDENCE_PATH;
const probeTokenFile = process.env.VALIDATION_PROBE_TOKEN_FILE;
if (!baseUrl || !runId || !sha || !evidencePath || !probeTokenFile) throw new Error("Validation evidence configuration is incomplete");
const probeToken = (await readFile(probeTokenFile, "utf8")).trim();
if (!/^[a-f0-9]{64}$/.test(probeToken)) throw new Error("Invalid temporary validation probe token");
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".workers.dev")) {
  throw new Error("Refusing a target outside the HTTPS workers.dev non-production namespace");
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

const evidence = {
  sha,
  runId,
  runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`,
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
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (Object.values(results).includes("FAIL")) process.exitCode = 1;
