import { RuntimeCapabilityError } from "../executors/capabilities.js";

let registeredFetch = null;

export const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];

export function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some((host) => hostname.includes(host));
  } catch {
    return false;
  }
}

export function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((pattern) => pattern.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

export function getEnvProxyUrl(targetUrl) {
  const env = globalThis.process?.env || {};
  const noProxy = env.NO_PROXY || env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  }

  return env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
}

export function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {
    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    return `http://${normalizedInput}`;
  }
}

export function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

export function buildVercelRelayRequest(targetUrl, options, relayUrl) {
  const parsed = new URL(typeof targetUrl === "string" ? targetUrl : targetUrl.toString());
  const baseHeaders = options.headers instanceof Headers
    ? Object.fromEntries(options.headers.entries())
    : { ...(options.headers || {}) };
  return {
    url: relayUrl,
    options: {
      ...options,
      headers: {
        ...baseHeaders,
        "x-relay-target": `${parsed.protocol}//${parsed.host}`,
        "x-relay-path": `${parsed.pathname}${parsed.search}`,
      },
    },
  };
}

export function registerExecutorFetch(fetchFn) {
  if (typeof fetchFn !== "function") throw new TypeError("executor fetch port must be a function");
  registeredFetch = fetchFn;
}

function hasProxyIntent(proxyOptions) {
  return !!(
    proxyOptions?.proxyPoolId ||
    proxyOptions?.enabled === true ||
    proxyOptions?.connectionProxyEnabled === true ||
    normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl)
  );
}

function missingCapability(capability) {
  throw new RuntimeCapabilityError("executor-fetch", "serverless-worker", [capability]);
}

export async function executorFetch(url, options = {}, proxyOptions = null) {
  if (registeredFetch) return registeredFetch(url, options, proxyOptions);

  const targetUrl = typeof url === "string" ? url : url.toString();
  const relayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (relayUrl) {
    const request = buildVercelRelayRequest(targetUrl, options, relayUrl);
    return globalThis.fetch(request.url, request.options);
  }

  if (shouldBypassMitmDns(targetUrl)) missingCapability("mitm-dns-bypass");

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  if (connectionProxyUrl || envProxyUrl || hasProxyIntent(proxyOptions)) {
    missingCapability("proxy-transport");
  }

  return globalThis.fetch(url, options);
}
