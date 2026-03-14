import { getRedis, isRedisEnabled } from "./redis.client.js"

const DEFAULT_TTL = {
  config: 5000,
  credentials: 5000,
  models: 60000,
  semantic: 300000,
  health: 10000
}

const memoryCache = new Map()
const MEMORY_CACHE_MAX_SIZE = 1000

function cleanupMemoryCache() {
  if (memoryCache.size <= MEMORY_CACHE_MAX_SIZE) return

  const now = Date.now()
  const keysToDelete = []

  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt < now) {
      keysToDelete.push(key)
    }
  }

  for (const key of keysToDelete) {
    memoryCache.delete(key)
  }

  if (memoryCache.size > MEMORY_CACHE_MAX_SIZE) {
    const entries = Array.from(memoryCache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)

    const toDelete = entries.slice(0, Math.floor(MEMORY_CACHE_MAX_SIZE * 0.2))
    for (const [key] of toDelete) {
      memoryCache.delete(key)
    }
  }
}

export class Cache {
  constructor(prefix = "ninerouter", defaultTtl = DEFAULT_TTL.config) {
    this.prefix = prefix
    this.defaultTtl = defaultTtl
  }

  _key(key) {
    return `${this.prefix}:${key}`
  }

  async get(key) {
    const fullKey = this._key(key)

    if (isRedisEnabled()) {
      try {
        const redis = await getRedis()
        if (redis) {
          const value = await redis.get(fullKey)
          if (value !== null) {
            try {
              return JSON.parse(value)
            } catch {
              return value
            }
          }
        }
      } catch (error) {
        console.error(`[Cache] Redis get error for ${fullKey}:`, error.message)
      }
    }

    const entry = memoryCache.get(fullKey)
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        return entry.value
      }
      memoryCache.delete(fullKey)
    }

    return null
  }

  async set(key, value, ttlMs) {
    const fullKey = this._key(key)
    const ttl = ttlMs ?? this.defaultTtl

    if (isRedisEnabled()) {
      try {
        const redis = await getRedis()
        if (redis) {
          const serialized = JSON.stringify(value)
          await redis.setex(fullKey, Math.ceil(ttl / 1000), serialized)
          return
        }
      } catch (error) {
        console.error(`[Cache] Redis set error for ${fullKey}:`, error.message)
      }
    }

    memoryCache.set(fullKey, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now()
    })

    cleanupMemoryCache()
  }

  async delete(key) {
    const fullKey = this._key(key)

    if (isRedisEnabled()) {
      try {
        const redis = await getRedis()
        if (redis) {
          await redis.del(fullKey)
        }
      } catch (error) {
        console.error(`[Cache] Redis delete error for ${fullKey}:`, error.message)
      }
    }

    memoryCache.delete(fullKey)
  }

  async getOrSet(key, fn, ttlMs) {
    const cached = await this.get(key)
    if (cached !== null) {
      return cached
    }

    const value = await fn()
    await this.set(key, value, ttlMs)
    return value
  }

  async exists(key) {
    const fullKey = this._key(key)

    if (isRedisEnabled()) {
      try {
        const redis = await getRedis()
        if (redis) {
          return (await redis.exists(fullKey)) === 1
        }
      } catch (error) {
        console.error(`[Cache] Redis exists error for ${fullKey}:`, error.message)
      }
    }

    const entry = memoryCache.get(fullKey)
    if (entry && entry.expiresAt > Date.now()) {
      return true
    }

    return false
  }

  async clear() {
    if (isRedisEnabled()) {
      try {
        const redis = await getRedis()
        if (redis) {
          const keys = await redis.keys(`${this.prefix}:*`)
          if (keys.length > 0) {
            await redis.del(...keys)
          }
        }
      } catch (error) {
        console.error("[Cache] Redis clear error:", error.message)
      }
    }

    for (const key of memoryCache.keys()) {
      if (key.startsWith(this.prefix)) {
        memoryCache.delete(key)
      }
    }
  }

  stats() {
    let memoryKeys = 0
    let memoryBytes = 0

    for (const [key, entry] of memoryCache) {
      if (key.startsWith(this.prefix)) {
        memoryKeys++
        memoryBytes += JSON.stringify(entry.value).length
      }
    }

    return {
      prefix: this.prefix,
      redisEnabled: isRedisEnabled(),
      memoryKeys,
      memoryBytes,
      defaultTtl: this.defaultTtl
    }
  }
}

export const configCache = new Cache("cfg", DEFAULT_TTL.config)
export const credentialsCache = new Cache("cred", DEFAULT_TTL.credentials)
export const semanticCache = new Cache("sem", DEFAULT_TTL.semantic)

export default Cache
