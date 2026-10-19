const RUNTIME_PROFILE_IDS = Object.freeze([
  'cloudflare-worker',
  'cloud-run',
  'docker-node',
  'local-bun',
  'local-node',
  'vercel-node',
]);

export const LOCAL_PERSISTENT_FAMILY = Object.freeze(['local-node', 'local-bun', 'docker-node']);

const validProfiles = new Set(RUNTIME_PROFILE_IDS);
const localProfiles = new Set(LOCAL_PERSISTENT_FAMILY);

export function resolveRuntimeProfile(env = process.env) {
  const configured = typeof env.RUNTIME_PROFILE === 'string' ? env.RUNTIME_PROFILE.trim() : '';
  let id;

  if (configured) {
    if (validProfiles.has(configured)) {
      id = configured;
    } else {
      id = 'unknown';
      console.warn(`[runtimeProfile] Ignoring invalid RUNTIME_PROFILE: ${configured}`);
    }
  } else if (env.NODE_ENV === 'development') {
    id = 'local-node';
  } else {
    id = 'unknown';
  }

  if (localProfiles.has(id) && env.K_SERVICE) {
    console.warn(`[runtimeProfile] K_SERVICE conflicts with local profile '${id}'; using unknown`);
    id = 'unknown';
  }

  return Object.freeze({ id, isLocalPersistent: localProfiles.has(id) });
}
