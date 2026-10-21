import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const pocDirectory = resolve(scriptDirectory, "..");
const configPath = process.env.VALIDATION_CONFIG;
const worker = process.env.VALIDATION_WORKER;
const databaseId = process.env.VALIDATION_DATABASE_ID;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const probeTokenFile = process.env.VALIDATION_PROBE_TOKEN_FILE;
if (!configPath || !/^9router-mem475-validation-[0-9]+-[0-9]+$/.test(worker || "") ||
    !/^[a-f0-9-]{36}$/i.test(databaseId || "") || !/^[a-f0-9]{32}$/i.test(accountId || "") || !probeTokenFile) {
  throw new Error("Refusing to write an invalid validation Worker config");
}
const probeToken = (await readFile(probeTokenFile, "utf8")).trim();
if (!/^[a-f0-9]{64}$/.test(probeToken)) throw new Error("Refusing an invalid temporary validation probe token");

const quote = (value) => JSON.stringify(value);
const config = [
  `name = ${quote(worker)}`,
  `main = ${quote(resolve(pocDirectory, "src/worker.js"))}`,
  `compatibility_date = "2026-10-18"`,
  `compatibility_flags = ["nodejs_compat"]`,
  `workers_dev = true`,
  `account_id = ${quote(accountId)}`,
  "",
  "[vars]",
  `VALIDATION_MODE = "true"`,
  `VALIDATION_PROBE_TOKEN = ${quote(probeToken)}`,
  `UPSTREAM_ORIGIN = "http://127.0.0.1:8788"`,
  "",
  "[[d1_databases]]",
  `binding = "DB"`,
  `database_name = ${quote(worker)}`,
  `database_id = ${quote(databaseId)}`,
  `migrations_dir = ${quote(resolve(pocDirectory, "migrations"))}`,
  "",
].join("\n");
await writeFile(configPath, config, { mode: 0o600 });
