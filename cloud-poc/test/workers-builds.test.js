import assert from "node:assert/strict";
import { test } from "node:test";
import { commandsFor, deployedWorkerUrl, run, validateBuildIdentity, validateDeploySettings } from "../scripts/workers-builds.mjs";
import { cleanupValidationRows } from "../scripts/validation-cleanup.mjs";

const validEnv = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "serverless-architecture",
  WORKERS_CI_COMMIT_SHA: "a".repeat(40),
  WORKERS_CI_BUILD_UUID: "12345678-1234-1234-1234-123456789abc",
  WORKERS_CI_ACCOUNT_ID: "a".repeat(32),
  D1_DATABASE_ID: "12345678-1234-1234-1234-123456789abc",
  VALIDATION_URL: "https://9router.account-subdomain.workers.dev",
  VALIDATION_PROBE_TOKEN: "ab".repeat(32),
};

const successfulCommand = (command, args) => ({
  status: 0,
  stdout: command === "npx" && args[1] === "deploy"
    ? "Published 9router (https://9router.account-subdomain.workers.dev)"
    : "sanitized test evidence",
  stderr: "",
});

test("invalid Workers Builds identities fail before any command", () => {
  for (const change of [
    { WORKERS_CI: undefined },
    { WORKERS_CI: "0" },
    { WORKERS_CI_BRANCH: "other" },
    { WORKERS_CI_COMMIT_SHA: "not-a-sha" },
  ]) {
    let invoked = false;
    assert.throws(() => run("deploy", { ...validEnv, ...change }, () => { invoked = true; }));
    assert.equal(invoked, false);
  }
});

test("deployment settings gate UUID, account, D1, target, and high-entropy credential", () => {
  for (const change of [
    { WORKERS_CI_ACCOUNT_ID: "bad" },
    { D1_DATABASE_ID: "bad" },
  ]) assert.throws(() => validateBuildIdentity({ ...validEnv, ...change }));
  for (const change of [
    { WORKERS_CI_BUILD_UUID: "" },
    { VALIDATION_URL: "https://other-account.workers.dev" },
    { VALIDATION_PROBE_TOKEN: "weak" },
  ]) assert.throws(() => validateDeploySettings({ ...validEnv, ...change }));
  assert.doesNotThrow(() => validateDeploySettings(validEnv));
});

test("deployed URL parser accepts only the named Worker and a unique identity", () => {
  assert.equal(deployedWorkerUrl("Published https://9router.account-subdomain.workers.dev"), validEnv.VALIDATION_URL);
  assert.throws(() => deployedWorkerUrl("Published https://other.account-subdomain.workers.dev"));
  assert.throws(() => deployedWorkerUrl("https://9router.a.workers.dev https://9router.b.workers.dev"));
});

test("deploy ordering passes only the exact deployment URL and identity to smoke", () => {
  const calls = [];
  run("deploy", validEnv, (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return successfulCommand(command, args);
  });
  assert.deepEqual(calls.map(({ args }) => args[0]), ["wrangler", "wrangler", "scripts/remote-validation.mjs"]);
  assert.deepEqual(calls.map(({ args }) => args.slice(0, 3)), [
    ["wrangler", "d1", "migrations"], ["wrangler", "deploy"], ["scripts/remote-validation.mjs"],
  ]);
  assert.equal(calls[2].env.WORKERS_CI_DEPLOYED_URL, validEnv.VALIDATION_URL);
  assert.equal(calls[2].env.MIGRATIONS_RESULT, "PASS");
  assert.equal(calls[2].env.DEPLOY_RESULT, "PASS");
  assert.equal(calls[2].env.WORKERS_CI_BUILD_UUID, validEnv.WORKERS_CI_BUILD_UUID);
});

test("target mismatch blocks smoke after deploy output identity is parsed", () => {
  let count = 0;
  assert.throws(() => run("deploy", { ...validEnv, VALIDATION_URL: "https://9router.other-subdomain.workers.dev" }, (command, args) => {
    count += 1;
    return successfulCommand(command, args);
  }));
  assert.equal(count, 2);
});

test("build sequence installs locked dependencies and does not mutate Cloudflare", () => {
  assert.deepEqual(commandsFor("build").map(([, args]) => args[0]), [
    "ci", "test", "run", "--check", "--check", "--check",
  ]);
});

test("cleanup retries partial failures and preserves outcomes for every D1 table", async () => {
  let call = 0;
  const result = await cleanupValidationRows(async () => {
    call += 1;
    return call === 1
      ? { status: 500, json: { outcomes: { api_keys: "deleted", ephemeral_probe: "failed" } } }
      : { status: 200, json: { outcomes: {
        api_keys: "absent", ephemeral_probe: "deleted", ephemeral_isolation: "absent",
        ephemeral_context: "cleaned:12", validation_background: "cleaned:1",
      } } };
  }, "run-unique", async () => {});
  assert.equal(call, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.ephemeral_probe.attempts, ["failed", "deleted"]);
  assert.equal(result.outcomes.ephemeral_context.outcome, "cleaned:12");
});
