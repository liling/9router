import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function reachableModules(entry) {
  const visited = new Set();
  const pending = [resolve(repoRoot, entry)];
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)];
    for (const [, specifier] of imports) {
      if (specifier.startsWith(".")) pending.push(resolve(dirname(current), specifier));
      else if (specifier.startsWith("@/")) pending.push(resolve(repoRoot, "src", specifier.slice(2)));
      else visited.add(specifier);
    }
  }
  return [...visited].map((path) => path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path);
}

describe("credential refresh state runtime boundary", () => {
  it("keeps the pure leaf free of Local-only dependencies", async () => {
    const graph = await reachableModules("open-sse/services/credentialRefreshState.js");
    expect(graph.filter((path) => /^(bun:|node:(sqlite|fs|path)$|undici$|jose$)/.test(path))).toEqual([]);
  });

  it("keeps the serverless executor graph off Local OAuth and persistence paths", async () => {
    const graph = await reachableModules("open-sse/executors/serverless.js");
    expect(graph.filter((path) =>
      /oauthCredentialManager\.js$|\/services\/tokenRefresh(?:\/|\.js)|^src\/lib\//.test(path) ||
      /^(bun:|node:(sqlite|fs|path|child_process)$|better-sqlite3$|sql\.js$)/.test(path)
    )).toEqual([]);
  });

  it("preserves the five refresh decisions from the prior implementation", async () => {
    const { shouldRefreshCredentials } = await import("../../open-sse/services/credentialRefreshState.js");
    const now = 2_000_000_000_000;
    const oneMinuteAheadSeconds = (now + 60_000) / 1000;
    const cases = [
      ["missing credentials", "codex", null, false],
      ["numeric expiry inside default lead", "unknown-provider", { expiresAt: oneMinuteAheadSeconds }, true],
      ["expiry beyond default lead", "unknown-provider", { expiresAt: now + 10 * 60_000 }, false],
      ["stale Codex refresh token", "codex", { refreshToken: "refresh" }, true],
      ["recent Codex refresh", "codex", { refreshToken: "refresh", lastRefreshAt: now - 60_000 }, false],
    ];
    for (const [name, provider, credentials, expected] of cases) {
      expect(shouldRefreshCredentials(provider, credentials, now), name).toBe(expected);
    }
  });

  it("re-exports identical pure functions through both Local paths", async () => {
    const leaf = await import("../../open-sse/services/credentialRefreshState.js");
    const manager = await import("../../open-sse/services/oauthCredentialManager.js");
    const tokenRefresh = await import("../../open-sse/services/tokenRefresh.js");
    for (const name of [
      "CODEX_MAX_REFRESH_AGE_MS",
      "getCredentialExpiryMs",
      "getCredentialLastRefreshMs",
      "getRefreshLeadMs",
      "isCodexRefreshStale",
      "shouldRefreshCredentials",
    ]) {
      expect(manager[name]).toBe(leaf[name]);
    }
    expect(tokenRefresh.getRefreshLeadMs).toBe(leaf.getRefreshLeadMs);
  });
});
