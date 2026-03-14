import { checkRateLimit, getRateLimitStatus, resetRateLimit, getRateLimitConfig } from "./rate-limiter.js"

export const RATE_LIMIT_TYPES = {
  API_KEY: "apiKey",
  IP: "ip",
  GLOBAL: "global",
  PROVIDER: "provider"
}

export function extractRateLimitKey(type, request) {
  switch (type) {
    case RATE_LIMIT_TYPES.API_KEY:
      const auth = request.headers?.get?.("authorization") || request.headers?.authorization
      if (auth?.startsWith("Bearer ")) {
        return auth.slice(7, 39)
      }
      return null

    case RATE_LIMIT_TYPES.IP:
      return request.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ||
             request.headers?.get?.("x-real-ip") ||
             request.ip ||
             "unknown"

    case RATE_LIMIT_TYPES.GLOBAL:
      return "global"

    case RATE_LIMIT_TYPES.PROVIDER:
      return request.provider || "unknown"

    default:
      return "unknown"
  }
}

export async function enforceRateLimit(request, provider = null) {
  if (!process.env.RATE_LIMIT_ENABLED || process.env.RATE_LIMIT_ENABLED === "false") {
    return { allowed: true }
  }

  const results = { allowed: true, checks: {} }

  const apiKey = extractRateLimitKey(RATE_LIMIT_TYPES.API_KEY, request)
  if (apiKey) {
    const check = await checkRateLimit("apiKey", apiKey)
    results.checks.apiKey = check
    if (!check.allowed) {
      results.allowed = false
      results.reason = "api_key_rate_limit"
      results.retryAfter = check.retryAfter
    }
  }

  if (results.allowed) {
    const ip = extractRateLimitKey(RATE_LIMIT_TYPES.IP, request)
    const ipCheck = await checkRateLimit("ip", ip)
    results.checks.ip = ipCheck
    if (!ipCheck.allowed) {
      results.allowed = false
      results.reason = "ip_rate_limit"
      results.retryAfter = ipCheck.retryAfter
    }
  }

  if (results.allowed && provider) {
    const providerCheck = await checkRateLimit("provider", provider)
    results.checks.provider = providerCheck
    if (!providerCheck.allowed) {
      results.allowed = false
      results.reason = "provider_rate_limit"
      results.retryAfter = providerCheck.retryAfter
    }
  }

  return results
}

export function rateLimitResponse(retryAfter, reason) {
  return new Response(JSON.stringify({
    error: {
      type: "rate_limit_error",
      message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      reason,
      retry_after: retryAfter
    }
  }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter)
    }
  })
}

export { checkRateLimit, getRateLimitStatus, resetRateLimit, getRateLimitConfig }
