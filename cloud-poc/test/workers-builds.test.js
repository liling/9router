import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { test } from "node:test";
import { commandsFor, deployedWorkerUrl, run, validateBuildIdentity, validateDeploySettings } from "../scripts/workers-builds.mjs";
import { cleanupValidationRows } from "../scripts/validation-cleanup.mjs";
import {
  createTemporaryWranglerSecrets,
  generateWranglerConfigText,
} from "../scripts/wrangler-config.mjs";

const validEnv = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "master",
  WORKERS_CI_COMMIT_SHA: "a".repeat(40),
  WORKERS_CI_BUILD_UUID: "12345678-1234-1234-1234-123456789abc",
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  D1_DATABASE_ID: "12345678-1234-1234-1234-123456789abc",
  VALIDATION_URL: "https://9router.account-subdomain.workers.dev",
  VALIDATION_PROBE_TOKEN: Array.from({ length: 64 }, (_, index) => "0123456789abcdef"[index % 16]).join(""),
};

const successfulCommand = (command, args) => ({
  status: 0,
  stdout: command === "npx" && args[1] === "deploy"
    ? "Published 9router (https://9router.account-subdomain.workers.dev)"
    : "sanitized test evidence",
  stderr: "",
});

test("generated Wrangler config uses concrete D1 UUID and native account selection", () => {
  const template = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const generated = generateWranglerConfigText(template, validEnv.D1_DATABASE_ID);
  assert.match(generated, new RegExp(`database_id = "${validEnv.D1_DATABASE_ID}"`));
  assert.doesNotMatch(template, /\$\{/);
  assert.doesNotMatch(generated, /\$\{/);
  assert.doesNotMatch(generated, /^account_id\s*=/m);
  assert.throws(() => generateWranglerConfigText(template, "not-a-uuid"));
});

test("invalid Workers Builds identities fail before any command", () => {
  for (const change of [
    { WORKERS_CI: undefined },
    { WORKERS_CI: "0" },
    { WORKERS_CI_BRANCH: "other" },
    { WORKERS_CI_BRANCH: "serverless-architecture" },
    { WORKERS_CI_COMMIT_SHA: "not-a-sha" },
  ]) {
    let invoked = false;
    assert.throws(() => run("deploy", { ...validEnv, ...change }, () => { invoked = true; }));
    assert.equal(invoked, false);
  }
});

test("deployment settings gate UUID, account, D1, target, and high-entropy credential", () => {
  for (const change of [
    { CLOUDFLARE_ACCOUNT_ID: "bad" },
    { D1_DATABASE_ID: "bad" },
  ]) assert.throws(() => validateBuildIdentity({ ...validEnv, ...change }));
  for (const change of [
    { WORKERS_CI_BUILD_UUID: "" },
    { VALIDATION_URL: "https://other-account.workers.dev" },
    { VALIDATION_PROBE_TOKEN: "weak" },
    { VALIDATION_PROBE_TOKEN: "ab".repeat(32) },
  ]) {
    assert.throws(() => validateDeploySettings({ ...validEnv, ...change }));
    let invoked = false;
    assert.throws(() => run("deploy", { ...validEnv, ...change }, () => { invoked = true; }));
    assert.equal(invoked, false);
  }
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
    if (args[1] === "d1") {
      const configPath = args.at(-1);
      assert.equal(args.at(-2), "--config");
      assert.match(readFileSync(configPath, "utf8"), new RegExp(`database_id = "${validEnv.D1_DATABASE_ID}"`));
      assert.doesNotMatch(readFileSync(configPath, "utf8"), /\$\{/);
    }
    if (args[1] === "deploy") {
      const secretsPath = args.at(-1);
      const configPath = args.at(-3);
      assert.equal(args.at(-4), "--config");
      assert.equal(args.at(-2), "--secrets-file");
      assert.match(readFileSync(configPath, "utf8"), new RegExp(`database_id = "${validEnv.D1_DATABASE_ID}"`));
      assert.doesNotMatch(readFileSync(configPath, "utf8"), /\$\{/);
      assert.equal(existsSync(secretsPath), true);
      assert.equal(statSync(secretsPath).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(readFileSync(secretsPath, "utf8")), {
        VALIDATION_PROBE_TOKEN: validEnv.VALIDATION_PROBE_TOKEN,
      });
    }
    return successfulCommand(command, args);
  });
  assert.deepEqual(calls.map(({ args }) => args[0]), ["wrangler", "wrangler", "scripts/remote-validation.mjs"]);
  assert.deepEqual(calls.map(({ args }) => args.slice(0, args[0] === "scripts/remote-validation.mjs" ? 1 : 2)), [
    ["wrangler", "d1"], ["wrangler", "deploy"], ["scripts/remote-validation.mjs"],
  ]);
  assert.equal(calls[2].env.WORKERS_CI_DEPLOYED_URL, validEnv.VALIDATION_URL);
  assert.equal(calls[2].env.MIGRATIONS_RESULT, "PASS");
  assert.equal(calls[2].env.DEPLOY_RESULT, "PASS");
  assert.equal(calls[2].env.WORKERS_CI_BUILD_UUID, validEnv.WORKERS_CI_BUILD_UUID);
  assert.equal(calls[0].args.at(-1), calls[1].args.at(-3));
  assert.equal(calls[0].env.CLOUDFLARE_ACCOUNT_ID, validEnv.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(existsSync(calls[1].args.at(-3)), false);
  assert.equal(existsSync(calls[1].args.at(-1)), false);
});

test("deploy command failure cleans both temporary files without leaking output", () => {
  const paths = [];
  let error;
  try {
    run("deploy", validEnv, (command, args) => {
      if (args[1] === "d1") return { status: 0, stdout: "sanitized test evidence", stderr: "" };
      if (args[1] === "deploy") paths.push(args.at(-3), args.at(-1));
      return { status: 1, stdout: validEnv.VALIDATION_PROBE_TOKEN, stderr: validEnv.VALIDATION_PROBE_TOKEN };
    });
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /output withheld/);
  assert.doesNotMatch(error.message, new RegExp(validEnv.VALIDATION_PROBE_TOKEN));
  assert.equal(paths.length, 2);
  for (const path of paths) assert.equal(existsSync(path), false);
});

test("target mismatch blocks smoke after deploy output identity is parsed", () => {
  let count = 0;
  assert.throws(() => run("deploy", { ...validEnv, VALIDATION_URL: "https://9router.other-subdomain.workers.dev" }, (command, args) => {
    count += 1;
    return successfulCommand(command, args);
  }));
  assert.equal(count, 2);
});

test("temporary validation secret is protected and cleaned", () => {
  const path = createTemporaryWranglerSecrets(validEnv.VALIDATION_PROBE_TOKEN);
  assert.match(path, /\.wrangler-builds-secrets-/);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    VALIDATION_PROBE_TOKEN: validEnv.VALIDATION_PROBE_TOKEN,
  });
  rmSync(path);
  const exclusivePath = createTemporaryWranglerSecrets(validEnv.VALIDATION_PROBE_TOKEN);
  rmSync(exclusivePath);
  assert.throws(() => createTemporaryWranglerSecrets("weak"));
});

test("build sequence installs locked dependencies and does not mutate Cloudflare", () => {
  const commands = commandsFor("build", ".generated-wrangler.toml");
  assert.deepEqual(commands.map(([, args]) => args[0]), [
    "ci", "test", "run", "--check", "--check", "--check", "--check", "--check", "--check",
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
