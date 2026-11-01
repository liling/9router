export const CAPABILITIES = Object.freeze([
  'http-fetch', 'http-proxy', 'mitm-dns', 'h2-duplex', 'node-stream',
  'fs-persistent', 'fs-ephemeral', 'process-spawn', 'local-socket', 'stable-timers',
]);

const LEGACY_CAPABILITIES = Object.freeze({
  'proxy-transport': 'http-proxy',
  'mitm-dns-bypass': 'mitm-dns',
  'node-fs': 'fs-persistent',
  'child-process': 'process-spawn',
});

export class RuntimeCapabilityError extends Error {
  constructor(code, details = {}, required) {
    const legacy = typeof details === 'string';
    const { capability, runtime, subject } = legacy
      ? { capability: required, runtime: details, subject: code }
      : details;
    const errorCode = legacy ? 'RUNTIME_CAPABILITY_UNAVAILABLE' : code;
    super(legacy
      ? `Executor '${code}' is not available in runtime '${details}'`
      : `${errorCode}${capability ? `: ${capability}` : ''}${runtime ? ` (${runtime})` : ''}`);
    this.name = 'RuntimeCapabilityError';
    this.code = errorCode;
    this.capability = capability;
    this.runtime = runtime;
    this.subject = subject;
    if (legacy) {
      this.provider = subject;
      this.requiredCapabilities = required;
    }
  }
}

export function normalizeCapability(capability) {
  return LEGACY_CAPABILITIES[capability] ?? capability;
}

export function hasCapabilities(descriptor, required = []) {
  const available = new Set(descriptor.capabilityTags.map(normalizeCapability));
  return required.every((tag) => available.has(normalizeCapability(tag)));
}

export function assertCapabilities(descriptor, required = [], subject) {
  for (const capability of required) {
    if (!hasCapabilities(descriptor, [capability])) {
      throw new RuntimeCapabilityError('RUNTIME_CAPABILITY_UNAVAILABLE', {
        capability: normalizeCapability(capability), runtime: descriptor.id, subject,
      });
    }
  }
}
