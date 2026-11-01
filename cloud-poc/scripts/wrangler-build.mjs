import { spawnSync } from "node:child_process";
import { createTemporaryWranglerConfig, removeTemporaryWranglerConfig } from "./wrangler-config.mjs";

let configPath = process.env.WORKERS_BUILDS_WRANGLER_CONFIG;
let ownedConfig = false;
try {
  if (!configPath) {
    configPath = createTemporaryWranglerConfig(process.env.D1_DATABASE_ID);
    ownedConfig = true;
  }
  const result = spawnSync("npx", ["wrangler", "deploy", "--dry-run", "--config", configPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (ownedConfig) removeTemporaryWranglerConfig(configPath);
}
