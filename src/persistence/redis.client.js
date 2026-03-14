import Redis from "ioredis"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const REDIS_ENABLED = process.env.REDIS_ENABLED === "true"

let redisClient = null
let connectionPromise = null

export function isRedisEnabled() {
  return REDIS_ENABLED && redisClient !== null && redisClient.status === "ready"
}

export async function getRedis() {
  if (!REDIS_ENABLED) {
    return null
  }

  if (!redisClient) {
    if (!connectionPromise) {
      connectionPromise = createConnection()
    }
    await connectionPromise
  }

  return redisClient
}

async function createConnection() {
  return new Promise((resolve, reject) => {
    try {
      redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 5000,
        commandTimeout: 5000
      })

      redisClient.on("connect", () => {
        console.log("[Redis] Connecting...")
      })

      redisClient.on("ready", () => {
        console.log("[Redis] Connected and ready")
        resolve(redisClient)
      })

      redisClient.on("error", (err) => {
        console.error("[Redis] Connection error:", err.message)
        if (redisClient.status !== "ready") {
          reject(err)
        }
      })

      redisClient.on("close", () => {
        console.log("[Redis] Connection closed")
      })

      redisClient.on("reconnecting", () => {
        console.log("[Redis] Reconnecting...")
      })

      redisClient.connect().catch(reject)
    } catch (error) {
      console.error("[Redis] Failed to create client:", error.message)
      redisClient = null
      reject(error)
    }
  })
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    connectionPromise = null
    console.log("[Redis] Connection closed")
  }
}

export async function redisHealthCheck() {
  if (!REDIS_ENABLED) {
    return { enabled: false, status: "disabled" }
  }

  try {
    const client = await getRedis()
    if (!client) {
      return { enabled: true, status: "unavailable" }
    }

    const start = Date.now()
    await client.ping()
    const latency = Date.now() - start

    return {
      enabled: true,
      status: "healthy",
      latency: `${latency}ms`
    }
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      error: error.message
    }
  }
}

export function getRedisStats() {
  if (!redisClient) {
    return { enabled: REDIS_ENABLED, connected: false }
  }

  return {
    enabled: REDIS_ENABLED,
    connected: redisClient.status === "ready",
    status: redisClient.status
  }
}

export default {
  getRedis,
  isRedisEnabled,
  closeRedis,
  redisHealthCheck,
  getRedisStats
}
