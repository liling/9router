const workerSafeProviders = new Set(["openai", "anthropic", "google"]);

export function getWorkerExecutor(provider) {
  if (!workerSafeProviders.has(provider)) {
    throw new Error(`Provider is not registered for Workers: ${provider}`);
  }
  return { kind: "fetch", provider };
}

export const excludedLocalProviders = Object.freeze([
  "cursor",
  "devin-cli",
  "ollama-local",
  "windsurf",
]);
