import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const path = process.env.EVIDENCE_PATH;
const cleanup = process.env.CLEANUP_RESULT || "not-started";
if (!path) throw new Error("Evidence path is required");
await mkdir(dirname(path), { recursive: true });
let evidence;
try {
  evidence = JSON.parse(await readFile(path, "utf8"));
} catch {
  evidence = {
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    target: "non-production isolated Cloudflare validation",
    startedAt: new Date().toISOString(),
    profile: "cloudflare-worker",
    ingress: "HTTPS workers.dev; no fixed application port",
    scheduler: "unavailable",
    executorChat: "not tested; configured loopback upstream is not edge reachable",
    secretFreeLogs: "no credentials or provider logs collected",
    outcomes: {},
  };
}
evidence.outcomes ||= {};
for (const [key, value] of Object.entries({
  localControl: process.env.LOCAL_CHECKS_RESULT,
  migrations: process.env.MIGRATIONS_RESULT,
  deploy: process.env.DEPLOY_RESULT,
  remoteSmoke: process.env.REMOTE_CHECKS_RESULT,
})) {
  if (value) evidence.outcomes[key] = value.toUpperCase();
}
evidence.cleanup = cleanup;
evidence.completedAt = new Date().toISOString();
await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Sanitized validation evidence finalized (cleanup: ${cleanup}).\n`);
