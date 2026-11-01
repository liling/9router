import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("failure fallback marks unobserved deployment claims as not-observed", () => {
  const directory = mkdtempSync(join(tmpdir(), "cloudflare-evidence-"));
  const evidencePath = join(directory, "evidence.json");
  try {
    const result = spawnSync(process.execPath, ["scripts/finalize-evidence.mjs"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        EVIDENCE_PATH: evidencePath,
        CLEANUP_RESULT: "not-started",
        GITHUB_SHA: "test-sha",
        GITHUB_RUN_ID: "123",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "liling/9router",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.target, "not-observed");
    assert.equal(evidence.profile, "not-observed");
    assert.equal(evidence.ingress, "not-observed");
    assert.equal(evidence.scheduler, "not-observed");
    assert.equal(evidence.executorChat, "not-observed");
    assert.equal(evidence.secretFreeLogs, "not-observed");
    assert.deepEqual(evidence.outcomes, {});
    assert.equal(evidence.cleanup, "not-started");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
