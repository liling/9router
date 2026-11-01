import { assertCapabilities, RuntimeCapabilityError } from "../runtime/capabilities.js";
import { getRuntimeProfile, RUNTIME_PROFILES as RUNTIME_DESCRIPTORS } from "../runtime/profiles/index.js";

const LOCAL_EXECUTORS = [
  "antigravity", "azure", "bedrock", "br", "bedrock-xai", "brx", "gemini-cli", "github",
  "iflow", "qoder", "qoder-cn", "kiro", "kimchi", "codex", "cursor", "cu", "vertex",
  "vertex-partner", "opencode", "opencode-go", "opencode-zen", "grok-web", "grok-cli", "gcli",
  "gb", "perplexity-web", "ollama-local", "commandcode", "xiaomi-tokenplan", "xiaomi-mimo",
  "mimo-free", "mmf", "codebuddy-cn", "codebuddy-intl", "trae", "zed", "windsurf",
  "minimax-code", "minimax-code-global", "devin-cli",
];

const LEGACY_TAGS = Object.freeze({
  "http-proxy": "proxy-transport",
  "mitm-dns": "mitm-dns-bypass",
  "fs-persistent": "node-fs",
  "process-spawn": "child-process",
});

const legacyProfileTags = (descriptor) => Object.freeze(
  descriptor.capabilityTags.map((tag) => LEGACY_TAGS[tag] || tag),
);

export const RUNTIME_PROFILES = Object.freeze({
  ...Object.fromEntries(Object.entries(RUNTIME_DESCRIPTORS).map(([id, descriptor]) => [id, legacyProfileTags(descriptor)])),
  "serverless-worker": legacyProfileTags(RUNTIME_DESCRIPTORS["cloudflare-worker"]),
});

export const EXECUTOR_CAPABILITIES = Object.freeze(Object.fromEntries(
  LOCAL_EXECUTORS.map((provider) => [provider, Object.freeze({ required: Object.freeze([]), localOnly: true })]),
));

export function getExecutorCapability(provider) {
  return EXECUTOR_CAPABILITIES[provider] ?? Object.freeze({ required: Object.freeze(["http-fetch"]), localOnly: false });
}

function resolveDescriptor(runtimeOrContext) {
  if (runtimeOrContext?.descriptor) return runtimeOrContext.descriptor;
  if (runtimeOrContext?.capabilityTags) return runtimeOrContext;
  if (typeof runtimeOrContext !== "string") return undefined;
  const profileId = runtimeOrContext === "serverless-worker" ? "cloudflare-worker" : runtimeOrContext;
  return getRuntimeProfile(profileId);
}

function unsupported(provider, runtime, required) {
  const error = new RuntimeCapabilityError("RUNTIME_CAPABILITY_UNAVAILABLE", {
    capability: required[0] || "process-spawn",
    runtime,
    subject: provider,
  });
  error.provider = provider;
  error.requiredCapabilities = required;
  return error;
}

export function assertExecutorCapabilities(provider, runtimeOrContext = "serverless-worker") {
  const capability = getExecutorCapability(provider);
  const descriptor = resolveDescriptor(runtimeOrContext);
  const runtimeName = typeof runtimeOrContext === "string" ? runtimeOrContext : descriptor?.id;
  if (!descriptor || capability.localOnly) {
    throw unsupported(provider, runtimeName || String(runtimeOrContext), capability.required);
  }
  try {
    assertCapabilities(descriptor, capability.required, provider);
  } catch (error) {
    if (!(error instanceof RuntimeCapabilityError)) throw error;
    error.provider = provider;
    error.requiredCapabilities = capability.required;
    error.runtime = runtimeName;
    throw error;
  }
  return capability;
}

export { RuntimeCapabilityError };
