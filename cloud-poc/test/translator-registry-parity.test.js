import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Provenance of the frozen baseline snapshot (do not edit the fixture by hand):
//   origin repository: liling/9router
//   origin commit SHA: b078c2f97686c597565b212c5c3c202ff224d410
//   origin path:       open-sse/translator/index.js
//   retrieval command: git show b078c2f97686c597565b212c5c3c202ff224d410:open-sse/translator/index.js \
//                        > cloud-poc/test-support/translator-index.b078c2f9.js
//   snapshot sha256:   9f2fa5db1f2d4e02e8ac2b41d1f7d6ba6a626b3dfac97796c1dc143f56ee03e2
//   snapshot size:     329 lines, 13489 bytes
// The snapshot is committed because Cloudflare Workers Builds clones shallowly and
// cannot reach a commit 101 revisions behind HEAD, so `git show` is unavailable there.
const baselineFixture = new URL("../test-support/translator-index.b078c2f9.js", import.meta.url);
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
  const oldIndex = await readFile(baselineFixture, "utf8");
  const registerAll = await readFile(new URL("../../open-sse/translator/register-all.js", import.meta.url), "utf8");
  assert.deepEqual(await registryKeys(importPaths(registerAll)), await registryKeys(importPaths(oldIndex)));
});
