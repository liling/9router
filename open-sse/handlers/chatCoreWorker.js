import "../translator/register-serverless.js";
import { detectFormat, getTargetFormat } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { getExecutor } from "../executors/serverless.js";
import { createStreamController } from "../utils/streamHandler.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";

const noOp = () => {};
const usageSink = Object.freeze({
  trackPendingRequest: noOp,
  appendRequestLog: noOp,
  saveRequestDetail: noOp,
  saveRequestUsage: noOp,
});
const requestLogger = Object.freeze({
  logProviderResponse: noOp,
  logConvertedResponse: noOp,
  logError: noOp,
});
const WORKER_API_KEY_PROVIDERS = new Set(["openai", "anthropic", "deepseek", "mistral", "groq", "xai"]);

export function isWorkerProviderSupported(provider) {
  return WORKER_API_KEY_PROVIDERS.has(provider);
}

export async function handleWorkerChatCore({ body, provider, model, credentials, signal, userAgent }) {
  if (!isWorkerProviderSupported(provider)) {
    return { response: Response.json({ error: "credential_unsupported" }, { status: 400 }) };
  }
  credentials = { ...credentials };
  const sourceFormat = detectFormat(body);
  const targetFormat = getTargetFormat(provider, credentials);
  const stream = Boolean(body.stream);
  const clientBody = { ...body };
  delete clientBody.providerId;
  const translatedBody = translateRequest(sourceFormat, targetFormat, model, clientBody, stream, credentials, provider);
  if (!translatedBody) {
    return { response: Response.json({ error: "request_translation_failed" }, { status: 400 }) };
  }
  translatedBody.model = model;

  const executor = getExecutor(provider);
  const { response: providerResponse, responseFormat = targetFormat } = await executor.execute({
    model,
    body: translatedBody,
    stream,
    credentials,
    signal,
  });
  if (providerResponse.status === 401 || providerResponse.status === 403) return { response: providerResponse };
  if (!providerResponse.ok) {
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    const result = createErrorResult(statusCode, formatProviderError(new Error(message), provider, model, statusCode), resetsAtMs);
    return { response: result.response };
  }

  const requestStartTime = Date.now();
  const common = {
    provider,
    model,
    sourceFormat,
    targetFormat: responseFormat,
    body: clientBody,
    stream,
    translatedBody,
    finalBody: translatedBody,
    requestStartTime,
    connectionId: credentials.connectionId,
    apiKey: null,
    clientRawRequest: null,
    onRequestSuccess: null,
    reqLogger: requestLogger,
    toolNameMap: null,
    customToolNames: null,
    usageSink,
    reqTag: "",
  };

  if (!stream) {
    const result = await handleNonStreamingResponse({
      ...common,
      providerResponse,
      trackDone: noOp,
      appendLog: noOp,
      log: null,
    });
    return { response: result.response };
  }

  const streamController = createStreamController({ provider, model });
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete(common);
  const result = await handleStreamingResponse({
    ...common,
    providerResponse,
    userAgent,
    streamController,
    onStreamComplete,
    streamDetailId,
    pxpipe: null,
    log: null,
    credentials,
  });
  return { response: result.response };
}
