import { describe, it, expect, beforeEach, afterEach } from "vitest"

describe("Cache", () => {
  let Cache

  beforeEach(async () => {
    const module = await import("../../src/persistence/cache.js")
    Cache = module.Cache
  })

  it("stores and retrieves values", async () => {
    const cache = new Cache("test", 5000)

    await cache.set("key1", { data: "value1" })
    const result = await cache.get("key1")

    expect(result).toEqual({ data: "value1" })
  })

  it("returns null for non-existent keys", async () => {
    const cache = new Cache("test", 5000)
    const result = await cache.get("non-existent")

    expect(result).toBeNull()
  })

  it("deletes values", async () => {
    const cache = new Cache("test", 5000)

    await cache.set("key1", { data: "value1" })
    await cache.delete("key1")
    const result = await cache.get("key1")

    expect(result).toBeNull()
  })

  it("uses getOrSet for computed values", async () => {
    const cache = new Cache("test-getOrSet", 5000)
    let callCount = 0

    const result1 = await cache.getOrSet(
      "computed-key",
      async () => {
        callCount++
        return { computed: true }
      },
      10000
    )

    const result2 = await cache.getOrSet(
      "computed-key",
      async () => {
        callCount++
        return { computed: false }
      },
      10000
    )

    expect(result1).toEqual({ computed: true })
    expect(result2).toEqual({ computed: true })
    expect(callCount).toBe(1)
  })

  it("returns stats", async () => {
    const cache = new Cache("test-stats", 5000)

    await cache.set("key1", { data: "1" })
    await cache.set("key2", { data: "2" })

    const stats = cache.stats()

    expect(stats.prefix).toBe("test-stats")
    expect(stats.memoryKeys).toBe(2)
  })
})

describe("Security - Rate Limiter", () => {
  let checkRateLimit
  let getRateLimitConfig

  beforeEach(async () => {
    const module = await import("../../src/security/index.js")
    checkRateLimit = module.checkRateLimit
    getRateLimitConfig = module.getRateLimitConfig
  })

  it("allows requests within limits", async () => {
    const result = await checkRateLimit("test", "key-1")
    expect(result.allowed).toBe(true)
  })

  it("returns rate limit config", () => {
    const config = getRateLimitConfig()
    expect(config.enabled).toBeDefined()
    expect(config.limits).toBeDefined()
    expect(config.limits.apiKey).toBeDefined()
    expect(config.limits.apiKey.points).toBeGreaterThan(0)
  })
})

describe("DLQ", () => {
  let addToDlq
  let getDlqStats
  let clearDlq

  beforeEach(async () => {
    const module = await import("../../src/lib/dlqDb.js")
    addToDlq = module.addToDlq
    getDlqStats = module.getDlqStats
    clearDlq = module.clearDlq
  })

  afterEach(async () => {
    await clearDlq()
  })

  it("adds entry to DLQ", async () => {
    const entry = await addToDlq({
      model: "test-model",
      provider: "test-provider",
      request: { model: "test-model", messages: [] },
      error: new Error("Test error"),
      connectionId: "test-conn"
    })

    expect(entry.id).toBeDefined()
    expect(entry.status).toBe("pending")
    expect(entry.provider).toBe("test-provider")
  })

  it("returns DLQ stats", async () => {
    await addToDlq({
      model: "model1",
      provider: "provider1",
      request: {},
      error: new Error("E1")
    })

    const stats = await getDlqStats()

    expect(stats.total).toBeGreaterThanOrEqual(1)
    expect(stats.pending).toBeGreaterThanOrEqual(1)
  })
})

describe("Logger", () => {
  let logger
  let createContextLogger

  beforeEach(async () => {
    const module = await import("../../src/observability/logger.js")
    logger = module.logger
    createContextLogger = module.createContextLogger
  })

  it("creates logger instance", () => {
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe("function")
    expect(typeof logger.warn).toBe("function")
    expect(typeof logger.error).toBe("function")
  })

  it("creates context logger", () => {
    const contextLogger = createContextLogger({ component: "test" })
    expect(contextLogger).toBeDefined()
    expect(typeof contextLogger.info).toBe("function")
  })
})

describe("Metrics", () => {
  let trackRequest
  let trackTokens
  let trackCost
  let getMetrics

  beforeEach(async () => {
    const module = await import("../../src/observability/metrics.js")
    trackRequest = module.trackRequest
    trackTokens = module.trackTokens
    trackCost = module.trackCost
    getMetrics = module.getMetrics
  })

  it("tracks requests", () => {
    expect(() => trackRequest("provider", "model", "success", "tier")).not.toThrow()
  })

  it("tracks tokens", () => {
    expect(() => trackTokens("provider", "model", 100, 50)).not.toThrow()
  })

  it("tracks costs", () => {
    expect(() => trackCost("provider", "model", 0.01)).not.toThrow()
  })

  it("returns metrics", async () => {
    const metrics = await getMetrics()
    expect(typeof metrics).toBe("string")
    expect(metrics.length).toBeGreaterThan(0)
  })
})
