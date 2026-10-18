import { DefaultExecutor } from "./default.js";
import { assertExecutorCapabilities } from "./capabilities.js";
import { getRuntime } from "../runtime/context.js";
import { RuntimeCapabilityError } from "../runtime/capabilities.js";

const defaultCache = new Map();

function currentRuntime() {
  try {
    return getRuntime();
  } catch (error) {
    if (!(error instanceof RuntimeCapabilityError) || error.code !== "RUNTIME_CONTEXT_NOT_INSTALLED") throw error;
    return "cloudflare-worker";
  }
}

export function getExecutor(provider) {
  assertExecutorCapabilities(provider, currentRuntime());
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  assertExecutorCapabilities(provider, currentRuntime());
  return false;
}

export { RuntimeCapabilityError } from "./capabilities.js";
