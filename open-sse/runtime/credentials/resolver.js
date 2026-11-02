import { assertConnectionRepository } from '../ports/connectionRepository.js';
import { assertSecretProvider } from '../ports/secretProvider.js';

const failure = (code) => Object.assign(new Error(code), { code });
const API_KEY_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'deepseek', 'mistral', 'groq', 'xai']);
const OAUTH_PROVIDERS = new Set(['github', 'codex', 'cursor', 'iflow', 'qoder']);

function validateEnvelope(raw, authType) {
  if (typeof raw !== 'string') return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || value.version !== 1 || value.authType !== authType) return null;
  const allowed = authType === 'api_key'
    ? new Set(['version', 'authType', 'apiKey'])
    : new Set(['version', 'authType', 'accessToken', 'expiresAt', 'tokenType', 'scope', 'projectId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (authType === 'api_key') return typeof value.apiKey === 'string' && value.apiKey.trim() ? { apiKey: value.apiKey } : null;
  if (typeof value.accessToken !== 'string' || !value.accessToken.trim() || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
  return Object.fromEntries(['accessToken', 'expiresAt', 'tokenType', 'scope', 'projectId'].filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

export async function resolveConnectionCredentials({ providerId, model, repository, secretProvider, excludedIds = [], noAuthProviders = [] }) {
  assertConnectionRepository(repository);
  assertSecretProvider(secretProvider);
  if (typeof providerId !== 'string' || !providerId || typeof model !== 'string' || !model) throw failure('credential_unsupported');
  if (!Array.isArray(excludedIds)) throw failure('credential_unsupported');
  let rows;
  try { rows = await repository.listEligibleConnections({ providerId, model, excludedIds }); }
  catch { throw failure('credential_source_unavailable'); }
  if (!Array.isArray(rows)) throw failure('credential_source_unavailable');
  for (const row of rows) {
    if (!row || row.providerId !== providerId || typeof row.id !== 'string' || typeof row.authType !== 'string') throw failure('credential_source_unavailable');
    if (excludedIds.includes(row.id)) throw failure('credential_source_unavailable');
    if (row.authType === 'none') {
      if (row.secretName) throw failure('credential_source_unavailable');
      if (noAuthProviders.includes(providerId)) return Object.freeze({ authType: 'none', connectionId: row.id });
      continue;
    }
    if (typeof row.secretName !== 'string' || !row.secretName) throw failure('credential_source_unavailable');
    const accepted = row.authType === 'api_key' ? API_KEY_PROVIDERS : row.authType === 'oauth' ? OAUTH_PROVIDERS : null;
    if (!accepted?.has(providerId)) continue;
    let raw;
    try { raw = await secretProvider.getSecret(row.secretName); } catch { throw failure('credential_source_unavailable'); }
    const fields = validateEnvelope(raw, row.authType);
    if (fields) return Object.freeze({ ...fields, authType: row.authType, connectionId: row.id });
  }
  throw failure('credential_unavailable');
}

export async function* credentialFallbackIterator(input) {
  const excludedIds = new Set(input.excludedIds || []);
  for (;;) {
    let result;
    try {
      result = await resolveConnectionCredentials({ ...input, excludedIds: [...excludedIds] });
    } catch (error) {
      if (error.code === 'credential_unavailable') return;
      throw error;
    }
    yield result;
    excludedIds.add(result.connectionId);
  }
}
