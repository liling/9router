export const SECRET_PROVIDER_METHODS = Object.freeze(['getSecret']);

export function assertSecretProvider(port) {
  if (typeof port?.getSecret !== 'function') throw new TypeError('SecretProvider.getSecret(name) is required');
  return port;
}
