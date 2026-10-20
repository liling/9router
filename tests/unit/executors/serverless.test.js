import { describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../../open-sse/executors/default.js";
import { getExecutor, hasSpecializedExecutor } from "../../../open-sse/executors/serverless.js";
import { assertExecutorCapabilities, getExecutorCapability, RUNTIME_PROFILES, RuntimeCapabilityError } from "../../../open-sse/executors/capabilities.js";
import { composeRuntime, installRuntime, resetRuntimeForTests } from "../../../open-sse/runtime/context.js";
import { composeCloudflareBaseRuntime } from "../../../open-sse/runtime/adapters/cloudflareProduction.js";

describe("serverless executor registry", () => {
  it("requires an installed runtime context", () => {
    resetRuntimeForTests();
    expect(() => getExecutor("openai")).toThrow(expect.objectContaining({ code: "RUNTIME_CONTEXT_NOT_INSTALLED" }));

    const httpTransport = { fetch: vi.fn() };
    installRuntime(composeRuntime("local-node", { httpTransport }));
    expect(() => getExecutor("devin-cli")).toThrow(expect.objectContaining({ runtime: "local-node" }));

    installRuntime(composeCloudflareBaseRuntime(httpTransport.fetch));
    expect(() => getExecutor("devin-cli")).toThrow(expect.objectContaining({ runtime: "cloudflare-worker" }));
    resetRuntimeForTests();
  });

  it("uses DefaultExecutor for generic HTTP providers", () => {
    const httpTransport = { fetch: vi.fn() };
    installRuntime(composeCloudflareBaseRuntime(httpTransport.fetch));
    expect(getExecutor("openai")).toBeInstanceOf(DefaultExecutor);
    expect(getExecutor("openai-compatible-custom")).toBeInstanceOf(DefaultExecutor);
    expect(hasSpecializedExecutor("openai")).toBe(false);
  });

  it("denies specialized local executors with structured capability errors", () => {
    expect(() => getExecutor("devin-cli")).toThrow(RuntimeCapabilityError);
    try {
      assertExecutorCapabilities("devin-cli");
    } catch (error) {
      expect(error).toMatchObject({ code: "RUNTIME_CAPABILITY_UNAVAILABLE", provider: "devin-cli", runtime: "serverless-worker" });
    }
  });

  it("defaults unlisted providers to the HTTP fetch capability", () => {
    expect(getExecutorCapability("future-http-provider")).toEqual({ required: ["http-fetch"], localOnly: false });
    expect(() => assertExecutorCapabilities("future-http-provider")).not.toThrow();
  });

  it("resolves capability tags from runtime profiles and context descriptors", () => {
    const descriptor = { id: "future-deno", capabilityTags: ["http-fetch"] };
    expect(() => assertExecutorCapabilities("future-http-provider", "cloudflare-worker")).not.toThrow();
    expect(() => assertExecutorCapabilities("future-http-provider", { descriptor })).not.toThrow();
    expect(() => assertExecutorCapabilities("future-http-provider", "serverless-worker")).not.toThrow();
    expect(RUNTIME_PROFILES["local-node"]).toContain("proxy-transport");
  });
});
