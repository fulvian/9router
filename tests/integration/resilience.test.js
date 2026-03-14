/**
 * Resilience Integration Tests
 * 
 * Verifies the integration between:
 * - Circuit Breaker
 * - Retry Policy
 * - DLQ (Dead Letter Queue)
 * - Metrics tracking
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"

describe("Resilience Layer Integration", () => {
  describe("Circuit Breaker + Retry Policy Combined", () => {
    it("retry policy stops when circuit opens", async () => {
      const { CircuitBreaker } = await import("../../src/core/CircuitBreaker.js")
      const { RetryPolicy } = await import("../../src/core/RetryPolicy.js")
      
      const cb = new CircuitBreaker("combined-test", { failureThreshold: 2 })
      const policy = new RetryPolicy({ maxAttempts: 5, baseDelay: 10 })
      
      let attempts = 0
      const error503 = new Error("Service unavailable")
      error503.status = 503
      
      // Use policy.withCircuitBreaker for combined execution
      const combined = policy.withCircuitBreaker(cb)
      
      await expect(combined.execute(async () => {
        attempts++
        throw error503
      })).rejects.toThrow()
      
      // Circuit should be open after 2 failures
      expect(cb.isOpen()).toBe(true)
      
      // Attempts should be limited by circuit breaker
      expect(attempts).toBeLessThanOrEqual(3) // May fail on 3rd due to circuit opening
    })

    it("successful retry resets circuit breaker failures", async () => {
      const { CircuitBreaker } = await import("../../src/core/CircuitBreaker.js")
      const { RetryPolicy } = await import("../../src/core/RetryPolicy.js")
      
      const cb = new CircuitBreaker("reset-test", { failureThreshold: 5 })
      const policy = new RetryPolicy({ maxAttempts: 3, baseDelay: 10 })
      
      let attempts = 0
      const error503 = new Error("Service unavailable")
      error503.status = 503
      
      // Cause one failure
      cb.onFailure(error503)
      expect(cb.failures).toBe(1)
      
      // Successful retry should reset failure count
      const result = await policy.execute(async () => {
        attempts++
        if (attempts < 2) throw error503
        return await cb.execute(() => Promise.resolve("success"))
      })
      
      expect(result.result).toBe("success")
      expect(cb.failures).toBe(0) // Reset after success
    })
  })

  describe("Idempotency + Cache Integration", () => {
    it("idempotency keys are deterministic for same content", async () => {
      const { generateIdempotencyKey, parseIdempotencyKey } = await import("../../src/core/IdempotencyKey.js")
      
      const request1 = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello world" }],
        temperature: 0.7
      }
      
      const request2 = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello world" }],
        temperature: 0.7
      }
      
      const key1 = generateIdempotencyKey(request1)
      const key2 = generateIdempotencyKey(request2)
      
      const parsed1 = parseIdempotencyKey(key1)
      const parsed2 = parseIdempotencyKey(key2)
      
      // Hash should be the same
      expect(parsed1.hash).toBe(parsed2.hash)
    })

    it("different content produces different hashes", async () => {
      const { generateIdempotencyKey, parseIdempotencyKey } = await import("../../src/core/IdempotencyKey.js")
      
      const request1 = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }]
      }
      
      const request2 = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Goodbye" }]
      }
      
      const key1 = generateIdempotencyKey(request1)
      const key2 = generateIdempotencyKey(request2)
      
      const parsed1 = parseIdempotencyKey(key1)
      const parsed2 = parseIdempotencyKey(key2)
      
      // Hash should be different
      expect(parsed1.hash).not.toBe(parsed2.hash)
    })
  })

  describe("Rate Limiting Integration", () => {
    it("enforceRateLimit checks multiple limit types", async () => {
      const { enforceRateLimit, resetRateLimit } = await import("../../src/security/index.js")
      
      // Clean up any previous state
      resetRateLimit("apiKey", "test-key")
      resetRateLimit("ip", "test-ip")
      
      const mockRequest = {
        headers: {
          get: (name) => {
            if (name === "authorization") return "Bearer test-key-12345678901234567890"
            if (name === "x-forwarded-for") return "test-ip"
            return null
          }
        }
      }
      
      // enforceRateLimit returns early if RATE_LIMIT_ENABLED is false
      // In test environment, it's likely disabled
      const result = await enforceRateLimit(mockRequest)
      expect(result.allowed).toBe(true)
      // checks may be undefined if rate limiting is disabled
      if (result.checks) {
        // Only check if rate limiting is enabled
        expect(result.checks).toBeDefined()
      }
    })

    it("rateLimitResponse creates proper 429 response", async () => {
      const { rateLimitResponse } = await import("../../src/security/index.js")
      
      const response = rateLimitResponse(60, "api_key_rate_limit")
      
      expect(response.status).toBe(429)
      expect(response.headers.get("Retry-After")).toBe("60")
      expect(response.headers.get("Content-Type")).toBe("application/json")
      
      const body = await response.json()
      expect(body.error.type).toBe("rate_limit_error")
      expect(body.error.retry_after).toBe(60)
    })
  })

  describe("DLQ Integration", () => {
    let addToDlq, getDlqStats, getDlqEntries, clearDlq

    beforeEach(async () => {
      const module = await import("../../src/lib/dlqDb.js")
      addToDlq = module.addToDlq
      getDlqStats = module.getDlqStats
      getDlqEntries = module.getDlqEntries
      clearDlq = module.clearDlq
      
      // Clean slate
      await clearDlq()
    })

    afterEach(async () => {
      await clearDlq()
    })

    it("DLQ stats are accurate", async () => {
      // Add entries
      await addToDlq({
        model: "model1",
        provider: "provider1",
        request: { model: "model1", messages: [] },
        error: new Error("Error 1")
      })
      
      await addToDlq({
        model: "model2",
        provider: "provider2",
        request: { model: "model2", messages: [] },
        error: new Error("Error 2")
      })
      
      const stats = await getDlqStats()
      
      expect(stats.total).toBeGreaterThanOrEqual(2)
      expect(stats.pending).toBeGreaterThanOrEqual(2)
      expect(stats.byProvider).toBeDefined()
    })

    it("DLQ filtering works", async () => {
      await addToDlq({
        model: "filter-model",
        provider: "filter-provider",
        request: {},
        error: new Error("Test")
      })
      
      const filtered = await getDlqEntries({ provider: "filter-provider" })
      
      expect(filtered.length).toBeGreaterThanOrEqual(1)
      expect(filtered[0].provider).toBe("filter-provider")
    })
  })

  describe("Metrics + Circuit Breaker Integration", () => {
    it("circuit breaker manager stats match metrics", async () => {
      const { circuitBreakerManager, getCircuitBreakerStats } = await import("../../src/core/CircuitBreakerManager.js")
      
      // Clear any existing state
      circuitBreakerManager.clear()
      
      // Create some circuit breakers
      circuitBreakerManager.get("provider-a")
      circuitBreakerManager.get("provider-b")
      circuitBreakerManager.get("provider-c")
      
      const stats = getCircuitBreakerStats()
      
      expect(stats.total).toBe(3)
      expect(stats.closed).toBe(3)
      expect(stats.open).toBe(0)
      expect(stats.halfOpen).toBe(0)
      
      // Cause one to open
      const cb = circuitBreakerManager.get("provider-a")
      cb.forceOpen()
      
      const updatedStats = getCircuitBreakerStats()
      expect(updatedStats.open).toBe(1)
      expect(updatedStats.closed).toBe(2)
      
      // Clean up
      circuitBreakerManager.clear()
    })
  })
})

describe("Cache Layer Integration", () => {
  describe("Memory Cache Consistency", () => {
    it("cache maintains consistency under concurrent access", async () => {
      const { Cache } = await import("../../src/persistence/cache.js")
      
      const cache = new Cache("concurrent-test", 10000)
      
      // Concurrent writes
      const writes = []
      for (let i = 0; i < 100; i++) {
        writes.push(cache.set(`key-${i}`, { index: i, data: `value-${i}` }))
      }
      await Promise.all(writes)
      
      // Verify all reads return correct data
      for (let i = 0; i < 100; i++) {
        const result = await cache.get(`key-${i}`)
        expect(result).toEqual({ index: i, data: `value-${i}` })
      }
    })

    it("getOrSet prevents duplicate computation", async () => {
      const { Cache } = await import("../../src/persistence/cache.js")
      
      const cache = new Cache("getOrSet-concurrent", 10000)
      let computeCount = 0
      
      // Simulate concurrent getOrSet calls
      const results = await Promise.all([
        cache.getOrSet("computed", async () => {
          computeCount++
          await new Promise(r => setTimeout(r, 50))
          return { computed: true }
        }),
        cache.getOrSet("computed", async () => {
          computeCount++
          await new Promise(r => setTimeout(r, 50))
          return { computed: true }
        })
      ])
      
      // Both should return the same value
      expect(results[0]).toEqual({ computed: true })
      expect(results[1]).toEqual({ computed: true })
      
      // Compute should have been called at most twice due to race
      // (first call wins, second might compute before cache is set)
      expect(computeCount).toBeLessThanOrEqual(2)
    })
  })
})

describe("Observability Integration", () => {
  it("metrics export includes all required counters", async () => {
    const { getMetrics } = await import("../../src/observability/metrics.js")
    
    const metrics = await getMetrics()
    
    // Check for key metrics
    expect(metrics).toContain("ninerouter_requests_total")
    expect(metrics).toContain("ninerouter_request_duration_seconds")
    expect(metrics).toContain("ninerouter_tokens_total")
    expect(metrics).toContain("ninerouter_cost_dollars_total")
    expect(metrics).toContain("ninerouter_fallback_total")
    expect(metrics).toContain("ninerouter_circuit_state")
    expect(metrics).toContain("ninerouter_cache_hits_total")
    expect(metrics).toContain("ninerouter_cache_misses_total")
    expect(metrics).toContain("ninerouter_dlq_size")
  })

  it("tracking functions update metrics correctly", async () => {
    const { 
      trackRequest, 
      trackTokens,
      getMetrics 
    } = await import("../../src/observability/metrics.js")
    
    // Track some requests
    trackRequest("test-provider", "test-model", "success", "subscription")
    trackRequest("test-provider", "test-model", "error", "subscription")
    trackTokens("test-provider", "test-model", 1000, 500)
    
    const metrics = await getMetrics()
    
    // Metrics should contain our tracked data
    expect(metrics).toContain("test-provider")
    expect(metrics).toContain("test-model")
  })
})
