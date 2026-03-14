import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";

import { chatLogger, routerLogger } from "@/observability/logger.js";
import { trackRequest, trackRequestDuration, trackFallback, trackTokens, trackCost } from "@/observability/metrics.js";
import { enforceRateLimit, rateLimitResponse } from "@/security/index.js";
import { getCircuitBreaker, CircuitOpenError } from "@/core/index.js";

export async function handleChat(request, clientRawRequest = null) {
  const startTime = Date.now()
  let body
  try {
    body = await request.json()
  } catch {
    chatLogger.warn({ event: "invalid_json" })
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body")
  }
  
  if (!clientRawRequest) {
    const url = new URL(request.url)
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    }
  }

  const url = new URL(request.url)
  const modelStr = body.model
  
  const rateLimitResult = await enforceRateLimit(request)
  if (!rateLimitResult.allowed) {
    chatLogger.warn({ 
      event: "rate_limited", 
      reason: rateLimitResult.reason,
      model: modelStr 
    })
    return rateLimitResponse(rateLimitResult.retryAfter, rateLimitResult.reason)
  }

  const msgCount = body.messages?.length || body.input?.length || body.contents?.length || 0
  const toolCount = body.tools?.length || 0
  const effort = body.reasoning_effort || body.reasoning?.effort || null
  
  chatLogger.info({
    event: "request",
    endpoint: url.pathname,
    model: modelStr,
    messages: msgCount,
    tools: toolCount,
    effort
  })
  
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const requestStartTime = Date.now()
  const modelInfo = await getModelInfo(modelStr)
  if (!modelInfo.provider) {
    chatLogger.warn({ event: "invalid_model", model: modelStr })
    log.warn("CHAT", "Invalid model format", { model: modelStr })
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format")
  }

  const { provider, model } = modelInfo

  routerLogger.info({ 
    event: "routing", 
    requested: modelStr, 
    resolved: `${provider}/${model}` 
  })
  
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`)
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`)
  }

  const userAgent = request?.headers?.get("user-agent") || ""
  
  const circuit = getCircuitBreaker(provider)
  if (circuit.isOpen()) {
    chatLogger.warn({ 
      event: "circuit_open", 
      provider,
      model,
      timeUntilReset: circuit.getTimeUntilReset() 
    })
    trackFallback(modelStr, "circuit_open", modelStr)
    trackRequest(provider, model, "circuit_open", "error")
    return unavailableResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE, 
      `Provider ${provider} is temporarily unavailable`,
      circuit.getTimeUntilReset()
    )
  }

  let excludeConnectionId = null
  let lastError = null
  let lastStatus = null

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionId, model)

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable"
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE
        chatLogger.warn({ 
          event: "all_rate_limited", 
          provider, 
          model, 
          error: errorMsg,
          retryAfter: credentials.retryAfterHuman 
        })
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`)
        trackRequest(provider, model, "rate_limited", "error")
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman)
      }
      if (!excludeConnectionId) {
        chatLogger.error({ event: "no_credentials", provider })
        log.error("AUTH", `No credentials for provider: ${provider}`)
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`)
      }
      chatLogger.warn({ event: "no_accounts", provider })
      log.warn("CHAT", "No more accounts available", { provider })
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable")
    }

    const accountId = credentials.connectionId.slice(0, 8)
    chatLogger.debug({ event: "account_selected", provider, account: accountId })
    log.info("AUTH", `Using ${provider} account: ${accountId}...`)

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials)
    
    try {
      const result = await handleChatCore({
        body: { ...body, model: `${provider}/${model}` },
        modelInfo: { provider, model },
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId: credentials.connectionId,
        userAgent,
        apiKey,
        onCredentialsRefreshed: async (newCreds) => {
          await updateProviderCredentials(credentials.connectionId, {
            accessToken: newCreds.accessToken,
            refreshToken: newCreds.refreshToken,
            providerSpecificData: newCreds.providerSpecificData,
            testStatus: "active"
          })
        },
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials)
        }
      })
      
      if (result.success) {
        const duration = (Date.now() - requestStartTime) / 1000
        trackRequestDuration(provider, model, duration)
        trackRequest(provider, model, "success", "subscription")
        
        if (result.usage) {
          trackTokens(provider, model, result.usage.prompt_tokens || 0, "prompt")
          trackTokens(provider, model, result.usage.completion_tokens || 0, "completion")
          if (result.cost) {
            trackCost(provider, model, result.cost)
          }
        }
        
        chatLogger.info({ 
          event: "request_success", 
          provider, 
          model, 
          duration,
          tokens: result.usage 
        })
        return result.response
      }

      const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model)
      
      if (shouldFallback) {
        chatLogger.warn({ 
          event: "account_fallback", 
          provider, 
          account: accountId, 
          status: result.status,
          error: result.error 
        })
        trackFallback(model, model, "account_error")
        log.warn("AUTH", `Account ${accountId}... unavailable (${result.status}), trying fallback`)
        excludeConnectionId = credentials.connectionId
        lastError = result.error
        lastStatus = result.status
        continue
      }

      return result.response
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        chatLogger.warn({ 
          event: "circuit_open_during_request", 
          provider, 
          model,
          timeUntilReset: error.timeUntilReset 
        })
        trackFallback(model, "circuit_open", model)
        trackRequest(provider, model, "circuit_open", "error")
        return unavailableResponse(
          HTTP_STATUS.SERVICE_UNAVAILABLE,
          `Provider ${provider} is temporarily unavailable`,
          error.timeUntilReset
        )
      }
      throw error
    }
  }
}
