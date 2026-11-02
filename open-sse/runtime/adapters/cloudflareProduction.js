import { composeRuntime } from '../context.js';
import { defineRuntimeDescriptor } from '../descriptor.js';
import { RUNTIME_PROFILES } from '../profiles/index.js';

const profile = RUNTIME_PROFILES['cloudflare-worker'];
const REQUEST_PORTS = ['persistence', 'ephemeral', 'backgroundTasks'];

function deriveProfile(availablePorts) {
  const available = new Set(availablePorts);
  return defineRuntimeDescriptor({
    ...profile,
    ports: Object.fromEntries(Object.entries(profile.ports).map(([id, declaration]) => {
      const next = { ...declaration, available: available.has(id) };
      if (next.available) delete next.planned;
      return [id, next];
    })),
  });
}

export const cloudflareBaseProfile = deriveProfile(['httpTransport']);
export const cloudflareRequestProfile = deriveProfile(['httpTransport', ...REQUEST_PORTS]);

export function composeCloudflareBaseRuntime(fetch = globalThis.fetch) {
  if (typeof fetch !== 'function') throw new TypeError('Cloudflare global fetch is required');
  return composeRuntime(cloudflareBaseProfile, {
    httpTransport: Object.freeze({ fetch: fetch.bind(globalThis) }),
  });
}

export function composeCloudflareRequestRuntime({
  baseRuntime, env, executionContext, ephemeralOptions,
  createApiKeyRepository, createEphemeralStore, createBackgroundTasks,
}) {
  if (!baseRuntime?.descriptor || baseRuntime.descriptor.id !== profile.id) {
    throw new TypeError('Cloudflare base RuntimeContext is required');
  }
  if (!env?.DB) throw new TypeError('Missing required runtime dependency: D1');
  if (typeof executionContext?.['wait' + 'Until'] !== 'function') {
    throw new TypeError('Missing required runtime dependency: Worker background registration');
  }
  if (![createApiKeyRepository, createEphemeralStore, createBackgroundTasks].every((factory) => typeof factory === 'function')) {
    throw new TypeError('Cloudflare production adapter factories are required');
  }
  const ephemeral = createEphemeralStore(env.DB, ephemeralOptions);
  const backgroundTasks = createBackgroundTasks({ executionContext });
  return composeRuntime(cloudflareRequestProfile, {
    httpTransport: baseRuntime.assertPort('httpTransport'),
    persistence: createApiKeyRepository(env.DB),
    ephemeral,
    backgroundTasks,
  });
}
