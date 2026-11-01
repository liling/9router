import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedBranch = "serverless-architecture";
const validSha = /^[a-f0-9]{40}$/i;

export function validateBuildIdentity(env) {
  if (env.WORKERS_CI !== "1") throw new Error("Workers Builds identity missing");
  if (env.WORKERS_CI_BRANCH !== expectedBranch) throw new Error("Unexpected Workers Builds branch");
  if (!validSha.test(env.WORKERS_CI_COMMIT_SHA || "")) throw new Error("Invalid Workers Builds commit SHA");
}

export function commandsFor(mode) {
  if (mode === "build") return [
    ["npm", ["ci"]],
    ["npm", ["test"]],
    ["npm", ["run", "build"]],
    ["node", ["--check", "scripts/workers-builds.mjs"]],
    ["node", ["--check", "scripts/remote-validation.mjs"]],
  ];
  if (mode === "deploy") return [
    ["npx", ["wrangler", "d1", "migrations", "apply", "9router", "--remote"]],
    ["npx", ["wrangler", "deploy"]],
    ["node", ["scripts/remote-validation.mjs"]],
  ];
  throw new Error("Expected build or deploy mode");
}

export function run(mode, env = process.env, execute = spawnSync) {
  validateBuildIdentity(env);
  if (mode === "deploy" && (!env.D1_DATABASE_ID || !env.VALIDATION_URL || !env.VALIDATION_PROBE_TOKEN)) {
    throw new Error("Workers Builds deployment settings are incomplete");
  }
  for (const [command, args] of commandsFor(mode)) {
    const commandEnv = mode === "deploy" && args[0] === "scripts/remote-validation.mjs"
      ? { ...env, MIGRATIONS_RESULT: "PASS", DEPLOY_RESULT: "PASS" }
      : env;
    const result = execute(command, args, { cwd: root, env: commandEnv, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Workers Builds command failed: ${command} ${args[0]}; output withheld`);
    }
    if (mode === "deploy" && args[0] === "scripts/remote-validation.mjs") {
      process.stdout.write(result.stdout || "");
    }
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
