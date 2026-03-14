import { describe, it, expect, beforeAll } from "vitest"

describe("Full Integration Tests", () => {
  describe("CircuitBreaker + Retry Integration", () => {
    it("retries on transient errors", async () => {
      const { RetryPolicy } = await import("../../src/core/RetryPolicy.js")
      const { CircuitBreaker } = await import("../../src/core/CircuitBreaker.js")

      const cb = new CircuitBreaker("test-provider", { failureThreshold: 5 })
      const policy = new RetryPolicy({ maxAttempts: 3, baseDelay: 10 })

      let callCount = 0

      const error = new Error("Service Unavailable")
      error.status = 503

      const result = await policy.execute(async () => {
        callCount++
        if (callCount < 2) {
          throw error
        }
        return await cb.execute(async () => "success")
      })

      expect(result.result).toBe("success")
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    it("circuit breaker opens after threshold", async () => {
      const { CircuitBreaker, CircuitState } = await import("../../src/core/CircuitBreaker.js")

      const cb = new CircuitBreaker("failing-provider", {
        failureThreshold: 2,
        resetTimeout: 1000
      })

      for (let i = 0; i < 3; i++) {
        try {
          await cb.execute(() => Promise.reject(new Error("Always fails")))
        } catch (e) {}
      }

      expect(cb.state).toBe(CircuitState.OPEN)
    })
  })

  describe("Cache Integration", () => {
    it("stores and retrieves values", async () => {
      const { Cache } = await import("../../src/persistence/cache.js")

      const cache = new Cache("integration-test", 5000)

      await cache.set("hit-test", { data: "cached" })

      const result = await cache.get("hit-test")
      expect(result).toEqual({ data: "cached" })

      const miss = await cache.get("miss-test")
      expect(miss).toBeNull()
    })

    it("uses getOrSet for computed values", async () => {
      const { Cache } = await import("../../src/persistence/cache.js")

      const cache = new Cache("getOrSet-test", 5000)
      let callCount = 0

      const result = await cache.getOrSet(
        "computed-key",
        async () => {
          callCount++
          return { computed: true, callCount }
        },
        10000
      )

      expect(result.computed).toBe(true)

      const cached = await cache.getOrSet(
        "computed-key",
        async () => {
          callCount++
          return { computed: false }
        },
        10000
      )

      expect(cached.computed).toBe(true)
      expect(callCount).toBe(1)
    })
  })

  describe("Rate Limiter Integration", () => {
    it("allows requests under limit", async () => {
      const { checkRateLimit } = await import("../../src/security/index.js")

      const result = await checkRateLimit("test", "key-under-limit")
      expect(result.allowed).toBe(true)
    })
  })

  describe("DLQ Integration", () => {
    it("adds failed request to DLQ", async () => {
      const { addToDlq, getDlqStats } = await import("../../src/lib/dlqDb.js")

      const entry = await addToDlq({
        model: "test-model",
        provider: "test-provider",
        request: { model: "test-model", messages: [] },
        error: new Error("Test error"),
        connectionId: "test-connection"
      })

      expect(entry.id).toBeDefined()
      expect(entry.status).toBe("pending")
      expect(entry.provider).toBe("test-provider")

      const stats = await getDlqStats()
      expect(stats).toBeDefined()
      expect(typeof stats.total).toBe("number")
    })
  })
})
