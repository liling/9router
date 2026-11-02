#!/usr/bin/env node

const API_BASE = "https://api.cloudflare.com/client/v4";
const GITHUB_MASTER_API = "https://api.github.com/repos/liling/9router/commits/master";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "837a65763ab7e548ed99488c309750fe";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SCRIPT_TAG = "0e2832fcd35943698710d441d1201910";
const WORKER_NAME = "9router";
const REPO_ID = "1423875319";
const REPO_NAME = "9router";
const PROVIDER = "github";
const FROM_BRANCH = "serverless-architecture";
const TO_BRANCH = "master";
const EXPECTED_MASTER_SHA = "60870d43ac2ea79cd42d456fafdef3968eb5b905";
const EXPECTED_ROOT_DIRECTORY = "cloud-poc";
const EXPECTED_BUILD_COMMAND = "npm run workers:build";
const EXPECTED_DEPLOY_COMMAND = "npm run workers:deploy";
const EXPECTED_D1_ID = "3963a45f-d00f-462a-9bcb-cd19e047f00f";
const EXPECTED_VALIDATION_URL = "https://9router.mem99.workers.dev";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 20 * 60 * 1_000;

function fail(message) {
  throw new Error(message);
}

function requireToken() {
  if (!API_TOKEN) {
    fail("CLOUDFLARE_API_TOKEN is required. Use a token with Workers CI Read/Write for this account.");
  }
}

async function cf(path, { method = "GET", body } = {}) {
  requireToken();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail(`Cloudflare API returned non-JSON for ${method} ${path}: HTTP ${response.status}`);
  }

  if (!response.ok || payload?.success !== true) {
    const errors = (payload?.errors || []).map((entry) => `${entry.code ?? "?"}: ${entry.message ?? "unknown"}`).join("; ");
    fail(`Cloudflare API failed for ${method} ${path}: HTTP ${response.status}${errors ? `; ${errors}` : ""}`);
  }
  return payload.result;
}

async function readGithubMasterSha() {
  const response = await fetch(GITHUB_MASTER_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "9router-mem-666-cutover",
    },
  });
  if (!response.ok) fail(`GitHub master lookup failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!/^[a-f0-9]{40}$/i.test(payload?.sha || "")) fail("GitHub master lookup returned an invalid SHA");
  return payload.sha;
}

async function assertExpectedMasterSha() {
  const masterSha = await readGithubMasterSha();
  if (masterSha !== EXPECTED_MASTER_SHA) {
    fail(`master drift detected: expected ${EXPECTED_MASTER_SHA}, got ${masterSha}. Refusing cutover.`);
  }
}

async function getBuildConfig() {
  return cf(`/accounts/${ACCOUNT_ID}/builds/workers/${SCRIPT_TAG}`);
}

async function getTriggers() {
  return cf(`/accounts/${ACCOUNT_ID}/builds/workers/${SCRIPT_TAG}/triggers`);
}

function expectedTrigger(triggers) {
  const candidates = triggers.filter((trigger) =>
    trigger.external_script_id === SCRIPT_TAG &&
    trigger.repo_connection?.repo_id === REPO_ID &&
    trigger.repo_connection?.repo_name === REPO_NAME &&
    trigger.repo_connection?.provider_type === PROVIDER &&
    trigger.root_directory === EXPECTED_ROOT_DIRECTORY &&
    trigger.build_command === EXPECTED_BUILD_COMMAND &&
    trigger.deploy_command === EXPECTED_DEPLOY_COMMAND &&
    trigger.deleted_on == null
  );
  if (candidates.length !== 1) {
    fail(`Expected exactly one production trigger, found ${candidates.length}`);
  }
  return candidates[0];
}

function assertBranchIncludes(trigger, branch) {
  const includes = trigger.branch_includes || [];
  const excludes = trigger.branch_excludes || [];
  if (includes.length !== 1 || includes[0] !== branch || excludes.length !== 0) {
    fail(`Unexpected trigger branch filters: includes=${JSON.stringify(includes)} excludes=${JSON.stringify(excludes)}`);
  }
}

function assertBuildConfig(config, allowedBranches) {
  if (config.script_tag !== SCRIPT_TAG) fail(`Unexpected script tag: ${config.script_tag}`);
  if (config.git_repository?.repo_id !== REPO_ID) fail(`Unexpected repo_id: ${config.git_repository?.repo_id}`);
  if (config.git_repository?.repo_name !== REPO_NAME) fail(`Unexpected repo_name: ${config.git_repository?.repo_name}`);
  if (config.git_repository?.provider_type !== PROVIDER) fail(`Unexpected provider: ${config.git_repository?.provider_type}`);
  if (!allowedBranches.includes(config.git_repository?.branch)) fail(`Unexpected production branch: ${config.git_repository?.branch}`);
  if (config.previews_enabled !== false) fail(`Previews must remain disabled; got ${config.previews_enabled}`);
  if (config.auto_build_enabled !== true) fail(`Auto build must remain enabled; got ${config.auto_build_enabled}`);

  const settings = config.production_settings || {};
  if (settings.root_directory !== EXPECTED_ROOT_DIRECTORY) fail(`Unexpected root_directory: ${settings.root_directory}`);
  if (settings.build_command !== EXPECTED_BUILD_COMMAND) fail(`Unexpected build_command: ${settings.build_command}`);
  if (settings.deploy_command !== EXPECTED_DEPLOY_COMMAND) fail(`Unexpected deploy_command: ${settings.deploy_command}`);
  if (settings.environment_variables?.D1_DATABASE_ID?.value !== EXPECTED_D1_ID) fail("Persistent D1 identity changed");
  if (settings.environment_variables?.VALIDATION_URL?.value !== EXPECTED_VALIDATION_URL) fail("Validation URL changed");
  if (settings.environment_variables?.VALIDATION_PROBE_TOKEN?.is_secret !== true) fail("Validation probe token is not marked secret");
}

function safeSummary(config, trigger) {
  return {
    worker: WORKER_NAME,
    script_tag: config.script_tag,
    repo: `${config.git_repository?.provider_account_name || "?"}/${config.git_repository?.repo_name || "?"}`,
    production_branch: config.git_repository?.branch,
    auto_build_enabled: config.auto_build_enabled,
    previews_enabled: config.previews_enabled,
    root_directory: config.production_settings?.root_directory,
    build_command: config.production_settings?.build_command,
    deploy_command: config.production_settings?.deploy_command,
    d1_database_id: config.production_settings?.environment_variables?.D1_DATABASE_ID?.value,
    validation_url: config.production_settings?.environment_variables?.VALIDATION_URL?.value,
    validation_probe_token_is_secret: config.production_settings?.environment_variables?.VALIDATION_PROBE_TOKEN?.is_secret,
    trigger_uuid: trigger.trigger_uuid,
    trigger_branch_includes: trigger.branch_includes,
  };
}

async function readAndValidate(allowedBranches) {
  const [config, triggers] = await Promise.all([getBuildConfig(), getTriggers()]);
  assertBuildConfig(config, allowedBranches);
  const trigger = expectedTrigger(triggers);
  assertBranchIncludes(trigger, config.git_repository.branch);
  return { config, trigger };
}

async function patchBranch(branch) {
  await cf(`/accounts/${ACCOUNT_ID}/builds/workers/${SCRIPT_TAG}`, {
    method: "PATCH",
    body: { git_repository: { branch } },
  });
}

async function waitForBranch(branch) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const state = await readAndValidate([branch]);
      if (state.config.git_repository.branch === branch) return state;
    } catch {
      // Cloudflare can take a short moment to update the production trigger after the config PATCH.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  fail(`Timed out waiting for Workers Builds branch to become ${branch}`);
}

async function startExactBuild(triggerUuid) {
  return cf(`/accounts/${ACCOUNT_ID}/builds/triggers/${triggerUuid}/builds`, {
    method: "POST",
    body: { commit_hash: EXPECTED_MASTER_SHA },
  });
}

async function getBuild(buildUuid) {
  return cf(`/accounts/${ACCOUNT_ID}/builds/builds/${buildUuid}`);
}

function buildSummary(build) {
  const metadata = build.build_trigger_metadata || {};
  return {
    build_uuid: build.build_uuid,
    status: build.status,
    build_outcome: build.build_outcome,
    branch: metadata.branch ?? null,
    commit_hash: metadata.commit_hash ?? null,
    trigger_source: metadata.build_trigger_source ?? null,
    root_directory: metadata.root_directory ?? null,
    created_on: build.created_on,
    stopped_on: build.stopped_on ?? null,
  };
}

async function waitForBuild(buildUuid) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastKey = "";
  while (Date.now() < deadline) {
    const build = await getBuild(buildUuid);
    const summary = buildSummary(build);
    const key = JSON.stringify(summary);
    if (key !== lastKey) {
      console.log("BUILD", JSON.stringify(summary));
      lastKey = key;
    }
    if (build.status === "stopped") return build;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  fail(`Timed out waiting for build ${buildUuid}`);
}

async function check() {
  const masterSha = await readGithubMasterSha();
  const { config, trigger } = await readAndValidate([FROM_BRANCH, TO_BRANCH]);
  console.log("CHECK", JSON.stringify({ master_sha: masterSha, ...safeSummary(config, trigger) }, null, 2));
  if (masterSha !== EXPECTED_MASTER_SHA) {
    fail(`master drift detected: expected ${EXPECTED_MASTER_SHA}, got ${masterSha}. Do not cut over without a fresh review.`);
  }
  console.log(config.git_repository.branch === FROM_BRANCH ? "READY_FOR_CUTOVER" : "ALREADY_ON_MASTER");
}

async function apply() {
  await assertExpectedMasterSha();

  const before = await readAndValidate([FROM_BRANCH]);
  console.log("BEFORE", JSON.stringify(safeSummary(before.config, before.trigger), null, 2));

  await assertExpectedMasterSha();
  console.log(`PATCH production branch: ${FROM_BRANCH} -> ${TO_BRANCH}`);
  await patchBranch(TO_BRANCH);
  const after = await waitForBranch(TO_BRANCH);
  console.log("AFTER", JSON.stringify(safeSummary(after.config, after.trigger), null, 2));

  await assertExpectedMasterSha();
  console.log(`TRIGGER exact build for ${EXPECTED_MASTER_SHA}`);
  const created = await startExactBuild(after.trigger.trigger_uuid);
  const buildUuid = created?.build_uuid;
  if (!buildUuid) fail("Build trigger response did not include build_uuid");

  const completed = await waitForBuild(buildUuid);
  const summary = buildSummary(completed);
  const metadata = completed.build_trigger_metadata || {};

  if (metadata.commit_hash !== EXPECTED_MASTER_SHA) {
    fail(`Build used unexpected commit: ${metadata.commit_hash || "<missing>"}`);
  }
  if (metadata.branch && metadata.branch !== TO_BRANCH) {
    fail(`Build reported unexpected branch: ${metadata.branch}`);
  }
  if (completed.build_outcome !== "success") {
    console.error("CUTOVER_BUILD_FAILED", JSON.stringify(summary, null, 2));
    console.error(`Rollback command: node cloud-poc/scripts/cutover-workers-builds.mjs --rollback`);
    process.exitCode = 2;
    return;
  }

  await readAndValidate([TO_BRANCH]);
  console.log("CUTOVER_BUILD_PASS", JSON.stringify(summary, null, 2));
  console.log("Workers Builds now tracks master, and the exact post-merge master SHA completed the configured build/deploy/smoke pipeline.");
}

async function rollback() {
  const before = await readAndValidate([TO_BRANCH]);
  console.log("ROLLBACK_BEFORE", JSON.stringify(safeSummary(before.config, before.trigger), null, 2));
  console.log(`PATCH production branch: ${TO_BRANCH} -> ${FROM_BRANCH}`);
  await patchBranch(FROM_BRANCH);
  const after = await waitForBranch(FROM_BRANCH);
  console.log("ROLLBACK_CONFIG_PASS", JSON.stringify(safeSummary(after.config, after.trigger), null, 2));
  console.log("Rollback changes only the Workers Builds production branch. It does not redeploy an older Worker version automatically.");
}

const mode = process.argv[2] || "--check";
try {
  if (mode === "--check") await check();
  else if (mode === "--apply") await apply();
  else if (mode === "--rollback") await rollback();
  else fail(`Unknown mode ${mode}. Use --check, --apply, or --rollback.`);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
