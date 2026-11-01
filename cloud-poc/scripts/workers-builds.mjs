import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTemporaryWranglerConfig,
  createTemporaryWranglerSecrets,
  removeTemporaryWranglerFile,
} from "./wrangler-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedBranch = "serverless-architecture";
const validSha = /^[a-f0-9]{40}$/i;
const validUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validD1Id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validAccountId = /^[a-f0-9]{32}$/i;
const probeTokenFormat = /^(?:[a-f0-9]{2}){32,}$/i;

function hasStrongProbeTokenEntropy(token) {
  if (!probeTokenFormat.test(token || "")) return false;
  const counts = new Map();
  for (const character of token.toLowerCase()) counts.set(character, (counts.get(character) || 0) + 1);
  const entropy = [...counts.values()].reduce((total, count) => {
    const probability = count / token.length;
    return total - probability * Math.log2(probability);
  }, 0);
  return counts.size >= 12 && entropy >= 3.25;
}

export function validateBuildIdentity(env) {
  if (env.WORKERS_CI !== "1") throw new Error("Workers Builds identity missing");
  if (env.WORKERS_CI_BRANCH !== expectedBranch) throw new Error("Unexpected Workers Builds branch");
  if (!validSha.test(env.WORKERS_CI_COMMIT_SHA || "")) throw new Error("Invalid Workers Builds commit SHA");
  if (!validAccountId.test(env.CLOUDFLARE_ACCOUNT_ID || "")) throw new Error("Invalid native Cloudflare account identity");
  if (!validD1Id.test(env.D1_DATABASE_ID || "")) throw new Error("Invalid persistent D1 identity");
}

export function validateDeploySettings(env) {
  if (!validUuid.test(env.WORKERS_CI_BUILD_UUID || "")) throw new Error("Invalid Workers Builds build UUID");
  if (!hasStrongProbeTokenEntropy(env.VALIDATION_PROBE_TOKEN)) throw new Error("Validation credential must be high entropy");
  const url = new URL(env.VALIDATION_URL || "invalid:");
  if (url.protocol !== "https:" || !/^9router\.[a-z0-9-]+\.workers\.dev$/i.test(url.hostname) || url.pathname !== "/") {
    throw new Error("Validation target must be the configured 9router Worker URL");
  }
}

export function deployedWorkerUrl(output) {
  const matches = [...output.matchAll(/https:\/\/9router\.[a-z0-9-]+\.workers\.dev\/?/gi)];
  const unique = [...new Set(matches.map(([url]) => url.replace(/\/$/, "")))];
  if (unique.length !== 1) throw new Error("Could not verify the deployed 9router Worker identity");
  return unique[0];
}

export function commandsFor(mode, configPath, secretsPath) {
  if (!configPath) throw new Error("Generated Wrangler config is required");
  if (mode === "build") return [
    ["npm", ["ci"]],
    ["npm", ["test"]],
    ["npm", ["run", "build"]],
    ["node", ["--check", "scripts/workers-builds.mjs"]],
    ["node", ["--check", "scripts/remote-validation.mjs"]],
    ["node", ["--check", "scripts/validation-cleanup.mjs"]],
    ["node", ["--check", "scripts/wrangler-config.mjs"]],
    ["node", ["--check", "scripts/wrangler-build.mjs"]],
    ["node", ["--check", "scripts/wrangler-dev.mjs"]],
  ];
  if (mode === "deploy") return [
    ["npx", ["wrangler", "d1", "migrations", "apply", "9router", "--remote", "--config", configPath]],
    ["npx", ["wrangler", "deploy", "--config", configPath, "--secrets-file", secretsPath]],
    ["node", ["scripts/remote-validation.mjs"]],
  ];
  throw new Error("Expected build or deploy mode");
}

export function run(mode, env = process.env, execute = spawnSync) {
  validateBuildIdentity(env);
  if (mode === "deploy") validateDeploySettings(env);
  const configPath = createTemporaryWranglerConfig(env.D1_DATABASE_ID);
  const secretsPath = mode === "deploy" ? createTemporaryWranglerSecrets(env.VALIDATION_PROBE_TOKEN) : undefined;
  const commandEnv = { ...env, WORKERS_BUILDS_WRANGLER_CONFIG: configPath };
  let deployedUrl;
  let migrationsResult = "not-observed";
  let deployResult = "not-observed";
  try {
    for (const [command, args] of commandsFor(mode, configPath)) {
      const isMigration = mode === "deploy" && args[0] === "wrangler" && args[1] === "d1";
      const isDeploy = mode === "deploy" && args[0] === "wrangler" && args[1] === "deploy";
      const isSmoke = mode === "deploy" && args[0] === "scripts/remote-validation.mjs";
      const currentEnv = isSmoke
        ? { ...commandEnv, WORKERS_CI_DEPLOYED_URL: deployedUrl, MIGRATIONS_RESULT: migrationsResult, DEPLOY_RESULT: deployResult }
        : commandEnv;
      const result = execute(command, args, { cwd: root, env: currentEnv, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Workers Builds command failed: ${command} ${args[0]}; output withheld`);
      }
      if (isMigration) migrationsResult = "PASS";
      if (isDeploy) {
        deployedUrl = deployedWorkerUrl(`${result.stdout || ""}\n${result.stderr || ""}`);
        if (deployedUrl !== new URL(env.VALIDATION_URL).origin) {
          throw new Error("Configured validation URL does not match this deployment's 9router Worker");
        }
        deployResult = "PASS";
      }
      if (isSmoke) process.stdout.write(result.stdout || "");
    }
  } finally {
    removeTemporaryWranglerFile(configPath);
    removeTemporaryWranglerFile(secretsPath, ".wrangler-builds-secrets-");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv[2]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
