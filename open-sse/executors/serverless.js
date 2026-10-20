import { DefaultExecutor } from "./default.js";
import { assertExecutorCapabilities } from "./capabilities.js";
import { getRuntime } from "../runtime/context.js";

const defaultCache = new Map();

export function getExecutor(provider) {
  assertExecutorCapabilities(provider, getRuntime());
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  assertExecutorCapabilities(provider, getRuntime());
  return false;
}

export { RuntimeCapabilityError } from "./capabilities.js";
