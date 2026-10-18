const LOCAL_EXECUTORS = [
  "antigravity", "azure", "bedrock", "br", "bedrock-xai", "brx", "gemini-cli", "github",
  "iflow", "qoder", "qoder-cn", "kiro", "kimchi", "codex", "cursor", "cu", "vertex",
  "vertex-partner", "opencode", "opencode-go", "opencode-zen", "grok-web", "grok-cli", "gcli",
  "gb", "perplexity-web", "ollama-local", "commandcode", "xiaomi-tokenplan", "xiaomi-mimo",
  "mimo-free", "mmf", "codebuddy-cn", "codebuddy-intl", "trae", "zed", "windsurf",
  "minimax-code", "minimax-code-global", "devin-cli",
];

export const RUNTIME_PROFILES = Object.freeze({
  "local-node": Object.freeze(["http-fetch", "node-stream", "node-fs", "child-process", "h2-duplex", "local-socket"]),
  "local-bun": Object.freeze(["http-fetch", "node-stream", "node-fs", "child-process", "h2-duplex", "local-socket"]),
  "serverless-worker": Object.freeze(["http-fetch"]),
});

export const EXECUTOR_CAPABILITIES = Object.freeze(Object.fromEntries(
  LOCAL_EXECUTORS.map(provider => [provider, Object.freeze({ required: Object.freeze([]), localOnly: true })]),
));

export function getExecutorCapability(provider) {
  return EXECUTOR_CAPABILITIES[provider] ?? Object.freeze({ required: Object.freeze(["http-fetch"]), localOnly: false });
}

export class RuntimeCapabilityError extends Error {
  constructor(provider, runtime, required) {
    super(`Executor '${provider}' is not available in runtime '${runtime}'`);
    this.name = "RuntimeCapabilityError";
    this.code = "RUNTIME_CAPABILITY_UNAVAILABLE";
    this.provider = provider;
    this.runtime = runtime;
    this.requiredCapabilities = required;
  }
}

export function assertExecutorCapabilities(provider, runtime = "serverless-worker") {
  const capability = getExecutorCapability(provider);
  const available = RUNTIME_PROFILES[runtime];
  const unsupported = capability.localOnly || !available || !capability.required.every(tag => available.includes(tag));
  if (unsupported) throw new RuntimeCapabilityError(provider, runtime, capability.required);
  return capability;
}
