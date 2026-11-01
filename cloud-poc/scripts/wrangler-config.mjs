import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configTemplatePath = resolve(root, "wrangler.toml");
const validD1Id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function generateWranglerConfigText(template, databaseId) {
  if (!validD1Id.test(databaseId || "")) throw new Error("D1_DATABASE_ID must be a concrete UUID");
  if (template.includes("${")) throw new Error("Wrangler config must not contain environment interpolation");
  const bindingSection = template.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g);
  if (bindingSection?.length !== 1) throw new Error("Expected exactly one persistent D1 binding");
  const block = bindingSection[0];
  if (!/^binding\s*=\s*"DB"\s*$/m.test(block) || /^database_id\s*=/m.test(block)) {
    throw new Error("Static Wrangler config must declare DB without a database ID");
  }
  const concreteBlock = block.replace(/(^binding\s*=\s*"DB"\s*$)/m, `$1\ndatabase_id = "${databaseId}"`);
  return template.replace(block, concreteBlock);
}

export function createTemporaryWranglerConfig(databaseId) {
  const template = readFileSync(configTemplatePath, "utf8");
  const content = generateWranglerConfigText(template, databaseId);
  const path = resolve(root, `.wrangler-builds-${process.pid}-${randomUUID()}.toml`);
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  return path;
}

export function createTemporaryWranglerSecrets(validationProbeToken) {
  if (!/^(?:[a-f0-9]{2}){32,}$/i.test(validationProbeToken || "")) {
    throw new Error("Validation credential must be high entropy");
  }
  const path = resolve(root, `.wrangler-builds-secrets-${process.pid}-${randomUUID()}.json`);
  writeFileSync(path, `${JSON.stringify({ VALIDATION_PROBE_TOKEN: validationProbeToken }, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

export function removeTemporaryWranglerFile(path, prefix = ".wrangler-builds-") {
  if (path && path.startsWith(`${root}/${prefix}`)) unlinkSync(path);
}
