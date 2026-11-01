import assert from "node:assert/strict";
import { test } from "node:test";
import { commandsFor, run } from "../scripts/workers-builds.mjs";

const validEnv = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "serverless-architecture",
  WORKERS_CI_COMMIT_SHA: "a".repeat(40),
  D1_DATABASE_ID: "configured-in-cloudflare",
  VALIDATION_URL: "https://9router.workers.dev",
  VALIDATION_PROBE_TOKEN: "secret-placeholder",
};

test("invalid Workers Builds identities fail before any command", () => {
  for (const change of [
    { WORKERS_CI: "0" },
    { WORKERS_CI_BRANCH: "other" },
    { WORKERS_CI_COMMIT_SHA: "not-a-sha" },
  ]) {
    let invoked = false;
    assert.throws(() => run("deploy", { ...validEnv, ...change }, () => { invoked = true; }));
    assert.equal(invoked, false);
  }
});

test("deploy command sequence migrates before deploy and smoke", () => {
  assert.deepEqual(commandsFor("deploy").map(([, args]) => args[0]), [
    "wrangler", "wrangler", "scripts/remote-validation.mjs",
  ]);
  assert.deepEqual(commandsFor("deploy").map(([, args]) => args.slice(0, 3)), [
    ["wrangler", "d1", "migrations"], ["wrangler", "deploy"], ["scripts/remote-validation.mjs"],
  ]);
});

test("build sequence installs locked dependencies and does not mutate Cloudflare", () => {
  assert.deepEqual(commandsFor("build").map(([, args]) => args[0]), [
    "ci", "test", "run", "--check", "--check",
  ]);
});
