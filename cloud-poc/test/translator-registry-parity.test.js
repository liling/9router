import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FORMATS } from "../../open-sse/translator/formats.js";

const baseline = "b078c2f97686c597565b212c5c3c202ff224d410";
const importPaths = (source) => [...source.matchAll(/^import "\.\/([^\"]+)";$/gm)].map((match) => match[1]);

async function registryKeys(paths) {
  const keys = [];
  for (const path of paths) {
    const source = await readFile(new URL(`../../open-sse/translator/${path}`, import.meta.url), "utf8");
    for (const [, from, to] of source.matchAll(/register\(FORMATS\.(\w+),\s*FORMATS\.(\w+)/g)) {
      keys.push(`${FORMATS[from]}:${FORMATS[to]}`);
    }
  }
  return [...new Set(keys)].sort();
}

test("translator registration keys match the pre-split registry", async () => {
  const oldIndex = execFileSync("git", ["show", `${baseline}:open-sse/translator/index.js`], { encoding: "utf8" });
  const registerAll = await readFile(new URL("../../open-sse/translator/register-all.js", import.meta.url), "utf8");
  assert.deepEqual(await registryKeys(importPaths(registerAll)), await registryKeys(importPaths(oldIndex)));
});
