import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const forbidden = [/proxyFetch\.js$/, /undici/, /node:sqlite/, /node:dns/, /node:child_process/, /bun:/];

async function staticGraph(entry) {
  const visited = new Set();
  const pending = [resolve(root, entry)];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (forbidden.some((pattern) => pattern.test(specifier))) {
        visited.add(specifier);
        continue;
      }
      if (specifier.startsWith(".")) pending.push(resolve(dirname(file), specifier));
      else visited.add(specifier);
    }
  }
  return [...visited].map((file) => file.replace(`${root}/`, ""));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("executor fetch port", () => {
  it("keeps the serverless executor graph clear of Local proxy dependencies", async () => {
    const graph = await staticGraph("open-sse/executors/serverless.js");
    expect(graph.filter((item) => forbidden.some((pattern) => pattern.test(item)))).toEqual([]);
  });

  it("allows direct fetch but rejects proxy and MITM requirements without Local registration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { executorFetch } = await import("../../open-sse/utils/executorFetch.js");

    await executorFetch("https://api.example.test");
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(executorFetch("https://api.example.test", {}, { enabled: true, url: "http://proxy.test" }))
      .rejects.toMatchObject({ name: "RuntimeCapabilityError", code: "RUNTIME_CAPABILITY_UNAVAILABLE" });
    await expect(executorFetch("https://api2.cursor.sh"))
      .rejects.toMatchObject({ name: "RuntimeCapabilityError", code: "RUNTIME_CAPABILITY_UNAVAILABLE" });
  });

  it("delegates through the Local proxy implementation after importing proxyFetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("local"));
    vi.stubGlobal("fetch", fetchMock);
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const { executorFetch } = await import("../../open-sse/utils/executorFetch.js");
    const response = await executorFetch("https://api.example.test", { method: "GET" });

    expect(await response.text()).toBe("local");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test", { method: "GET" });
    expect(proxyAwareFetch).toBeTypeOf("function");
  });

  it("keeps proxy helper normalization deterministic", async () => {
    const { normalizeString, normalizeProxyUrl, shouldBypassByNoProxy, resolveConnectionProxyUrl } =
      await import("../../open-sse/utils/executorFetch.js");

    expect(normalizeString(null)).toBe("");
    expect(normalizeProxyUrl("localhost:8080")).toBe("localhost:8080");
    expect(shouldBypassByNoProxy("https://api.example.test", ".example.test")).toBe(true);
    expect(resolveConnectionProxyUrl("https://api.other.test", {
      enabled: true, url: "proxy.test:8080", noProxy: "example.test",
    })).toBe("proxy.test:8080");
  });

  it("accepts the HttpTransport object shape while preserving the legacy registrar", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("port"));
    const { executorFetch, registerExecutorFetch } = await import("../../open-sse/utils/executorFetch.js");
    registerExecutorFetch({ fetch });

    const response = await executorFetch("https://api.example.test", { method: "GET" });
    expect(await response.text()).toBe("port");
    expect(fetch).toHaveBeenCalledWith("https://api.example.test", { method: "GET" }, null);
  });
});
