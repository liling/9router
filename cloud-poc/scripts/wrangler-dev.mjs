import { spawnSync } from "node:child_process";
import { createTemporaryWranglerConfig, removeTemporaryWranglerFile } from "./wrangler-config.mjs";

let configPath;
try {
  configPath = createTemporaryWranglerConfig(process.env.D1_DATABASE_ID || "00000000-0000-0000-0000-000000000001");
  const result = spawnSync("npx", ["wrangler", "dev", "--config", configPath], {
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
  if (configPath) removeTemporaryWranglerFile(configPath);
}
