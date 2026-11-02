import { assertSecretProvider } from '../ports/secretProvider.js';

export function createCloudflareSecretProvider(env) {
  return assertSecretProvider(Object.freeze({
    async getSecret(secretName) {
      if (typeof secretName !== 'string' || !secretName || !env || !Object.hasOwn(env, secretName)) return null;
      const binding = env[secretName];
      if (typeof binding === 'string') return binding;
      return null;
    },
  }));
}
