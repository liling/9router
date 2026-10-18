import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../../open-sse/executors/default.js";
import { getExecutor, hasSpecializedExecutor } from "../../../open-sse/executors/serverless.js";
import { assertExecutorCapabilities, getExecutorCapability, RuntimeCapabilityError } from "../../../open-sse/executors/capabilities.js";

describe("serverless executor registry", () => {
  it("uses DefaultExecutor for generic HTTP providers", () => {
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
});
