import { RateLimiterMemory } from "rate-limiter-flexible"

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false"

const limits = {
  apiKey: {
    points: parseInt(process.env.RATE_LIMIT_API_KEY_POINTS || "100"),
    duration: parseInt(process.env.RATE_LIMIT_API_KEY_DURATION || "60")
  },
  ip: {
    points: parseInt(process.env.RATE_LIMIT_IP_POINTS || "20"),
    duration: parseInt(process.env.RATE_LIMIT_IP_DURATION || "60")
  },
  global: {
    points: parseInt(process.env.RATE_LIMIT_GLOBAL_POINTS || "1000"),
    duration: parseInt(process.env.RATE_LIMIT_GLOBAL_DURATION || "60")
  },
  provider: {
    points: parseInt(process.env.RATE_LIMIT_PROVIDER_POINTS || "100"),
    duration: parseInt(process.env.RATE_LIMIT_PROVIDER_DURATION || "60")
  }
}

const limiters = {}

function getOrCreateLimiter(type) {
  if (!limiters[type]) {
    const config = limits[type]
    if (!config) return null

    limiters[type] = new RateLimiterMemory({
      points: config.points,
      duration: config.duration,
      keyPrefix: `rl_${type}`
    })
  }
  return limiters[type]
}

export async function checkRateLimit(type, key) {
  if (!RATE_LIMIT_ENABLED) {
    return { allowed: true }
  }

  const limiter = getOrCreateLimiter(type)
  if (!limiter) {
    return { allowed: true }
  }

  try {
    await limiter.consume(key)
    return { allowed: true }
  } catch (error) {
    if (error.msBeforeNext) {
      return {
        allowed: false,
        retryAfter: Math.ceil(error.msBeforeNext / 1000),
        remainingPoints: error.remainingPoints || 0
      }
    }
    return { allowed: true }
  }
}

export function getRateLimitStatus(type, key) {
  const limiter = getOrCreateLimiter(type)
  if (!limiter) {
    return { available: false }
  }

  try {
    const result = limiter.get(key)
    return {
      available: true,
      remainingPoints: result?.remainingPoints || limits[type]?.points || 0
    }
  } catch {
    return { available: false }
  }
}

export function resetRateLimit(type, key) {
  const limiter = getOrCreateLimiter(type)
  if (limiter) {
    limiter.delete(key)
  }
}

export function getRateLimitConfig() {
  return {
    enabled: RATE_LIMIT_ENABLED,
    limits: {
      apiKey: { ...limits.apiKey, current: limiters.apiKey?.points || limits.apiKey.points },
      ip: { ...limits.ip, current: limiters.ip?.points || limits.ip.points },
      global: { ...limits.global, current: limiters.global?.points || limits.global.points },
      provider: { ...limits.provider, current: limiters.provider?.points || limits.provider.points }
    }
  }
}

export default {
  checkRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  getRateLimitConfig
}
