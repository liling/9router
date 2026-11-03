import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function reachableModules(entry) {
  const visited = new Set();
  const pending = [resolve(repoRoot, entry)];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    const specifiers = [
      ...[...source.matchAll(/^[ \t]*(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm)].map((match) => match[1]),
      ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
      ...[...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
    ];
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) pending.push(resolve(dirname(current), specifier));
      else if (specifier.startsWith("@/")) pending.push(resolve(repoRoot, "src", specifier.slice(2)));
      else visited.add(specifier);
    }
  }
  return [...visited].map((path) => path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path);
}

test("Worker chat path excludes Local-only production dependencies", async () => {
  const graph = await reachableModules("open-sse/handlers/chatCoreWorker.js");
  const forbidden = graph.filter((path) =>
    /^src\/lib\//.test(path) ||
    /oauthCredentialManager\.js$|tokenRefresh(?:\/|\.js)/.test(path) ||
    /^open-sse\/executors\/index\.js$|^open-sse\/executors\/devin-cli\.js$/.test(path) ||
    /proxyFetch\.js$|^open-sse\/translator\/concerns\/prefetch\.js$|^open-sse\/rtk\//.test(path) ||
    /^(bun:|node:(sqlite|fs|path|child_process|dns|https|net)$|undici$|better-sqlite3$|sql\.js$)/.test(path)
  );
  assert.deepEqual(forbidden, []);
});

test("Worker entrypoint does not configure a loopback upstream origin", async () => {
  const source = await readFile(resolve(repoRoot, "cloud-poc/src/worker.js"), "utf8");
  assert.doesNotMatch(source, /UPSTREAM_ORIGIN|runtimeTransport|translateJSONResponse|translateSSE/);
  assert.match(source, /handleWorkerChatCore/);
});
