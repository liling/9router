import { DefaultExecutor } from "./default.js";
import { assertExecutorCapabilities } from "./capabilities.js";

const defaultCache = new Map();

export function getExecutor(provider) {
  assertExecutorCapabilities(provider, "serverless-worker");
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  assertExecutorCapabilities(provider, "serverless-worker");
  return false;
}

export { RuntimeCapabilityError } from "./capabilities.js";
