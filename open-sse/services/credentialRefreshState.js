import { REFRESH_LEAD_MS } from "../config/appConstants.js";
import { PROVIDER_OAUTH } from "../providers/index.js";

export const CODEX_MAX_REFRESH_AGE_MS = PROVIDER_OAUTH["codex"]?.maxRefreshAgeMs;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function parseTimeMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCredentialExpiryMs(credentials) {
  return parseTimeMs(credentials?.expiresAt ?? credentials?.tokenExpiresAt);
}

export function getCredentialLastRefreshMs(credentials) {
  return parseTimeMs(
    credentials?.lastRefreshAt ??
    credentials?.lastRefresh ??
    credentials?.providerSpecificData?.lastRefreshAt
  );
}

export function isCodexRefreshStale(credentials, nowMs = Date.now(), maxAgeMs = CODEX_MAX_REFRESH_AGE_MS) {
  const lastRefreshMs = getCredentialLastRefreshMs(credentials);
  return !lastRefreshMs || nowMs - lastRefreshMs >= maxAgeMs;
}

export function getRefreshLeadMs(provider) {
  if (REFRESH_LEAD_MS[provider]) return REFRESH_LEAD_MS[provider];
  if (provider === "kimi-coding" && REFRESH_LEAD_MS.kimi) return REFRESH_LEAD_MS.kimi;
  return TOKEN_EXPIRY_BUFFER_MS;
}

export function shouldRefreshCredentials(provider, credentials, nowMs = Date.now()) {
  if (!credentials) return false;

  const expiresAtMs = getCredentialExpiryMs(credentials);
  if (expiresAtMs !== null && expiresAtMs - nowMs < getRefreshLeadMs(provider)) {
    return true;
  }

  const maxAgeMs = PROVIDER_OAUTH[provider]?.maxRefreshAgeMs;
  if (maxAgeMs && credentials.refreshToken && isCodexRefreshStale(credentials, nowMs, maxAgeMs)) {
    return true;
  }

  return false;
}
