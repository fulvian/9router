import { describe, it, expect, beforeEach } from "vitest"

describe("CircuitBreaker", () => {
  let CircuitBreaker
  let CircuitState

  beforeEach(async () => {
    const module = await import("../../src/core/CircuitBreaker.js")
    CircuitBreaker = module.CircuitBreaker
    CircuitState = module.CircuitState
  })

  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 })
    expect(cb.state).toBe(CircuitState.CLOSED)
    expect(cb.isClosed()).toBe(true)
  })

  it("transitions to OPEN after threshold failures", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 })
    
    cb.onFailure(new Error("E1"))
    cb.onFailure(new Error("E2"))
    cb.onFailure(new Error("E3"))
    
    expect(cb.state).toBe(CircuitState.OPEN)
    expect(cb.isOpen()).toBe(true)
  })

  it("resets to CLOSED", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 })
    
    cb.onFailure(new Error("E1"))
    expect(cb.state).toBe(CircuitState.OPEN)
    
    cb.reset()
    expect(cb.state).toBe(CircuitState.CLOSED)
  })

  it("tracks total calls", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 10 })
    
    await cb.execute(() => Promise.resolve("result1"))
    await cb.execute(() => Promise.resolve("result2"))
    
    expect(cb.totalCalls).toBe(2)
    expect(cb.totalSuccesses).toBe(2)
  })

  it("returns state object", () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 })
    cb.onFailure(new Error("E"))
    
    const state = cb.getState()
    
    expect(state.providerId).toBe("test")
    expect(state.failures).toBe(1)
    expect(state.failureThreshold).toBe(3)
  })
})

describe("CircuitBreakerManager", () => {
  let circuitBreakerManager

  beforeEach(async () => {
    const module = await import("../../src/core/CircuitBreakerManager.js")
    circuitBreakerManager = module.circuitBreakerManager
    circuitBreakerManager.clear()
  })

  afterEach(() => {
    circuitBreakerManager.clear()
  })

  it("creates and retrieves circuit breakers", () => {
    const cb1 = circuitBreakerManager.get("provider1")
    const cb2 = circuitBreakerManager.get("provider2")

    expect(cb1).toBeDefined()
    expect(cb2).toBeDefined()
    
    const cb1Again = circuitBreakerManager.get("provider1")
    expect(cb1Again).toBe(cb1)
  })

  it("returns stats", () => {
    circuitBreakerManager.get("p1")
    circuitBreakerManager.get("p2")
    circuitBreakerManager.get("p3")

    const stats = circuitBreakerManager.getStats()

    expect(stats.total).toBe(3)
    expect(stats.closed).toBe(3)
  })

  it("resets specific circuit breaker", () => {
    circuitBreakerManager.get("to-reset")
    circuitBreakerManager.reset("to-reset")

    expect(circuitBreakerManager.has("to-reset")).toBe(false)
  })
})

describe("RetryPolicy", () => {
  let RetryPolicy

  beforeEach(async () => {
    const module = await import("../../src/core/RetryPolicy.js")
    RetryPolicy = module.RetryPolicy
  })

  it("succeeds on first try", async () => {
    const policy = new RetryPolicy({ maxAttempts: 3, baseDelay: 10 })
    let callCount = 0

    const result = await policy.execute(async () => {
      callCount++
      return "success"
    })

    expect(result.result).toBe("success")
    expect(result.totalAttempts).toBe(1)
    expect(callCount).toBe(1)
  })

  it("retries on retryable error", async () => {
    const policy = new RetryPolicy({ maxAttempts: 3, baseDelay: 10 })
    let callCount = 0

    const error = new Error("Network error")
    error.status = 503

    const result = await policy.execute(async () => {
      callCount++
      if (callCount < 2) {
        throw error
      }
      return "success"
    })

    expect(result.result).toBe("success")
    expect(callCount).toBe(2)
  })

  it("calculates delay with exponential backoff", () => {
    const policy = new RetryPolicy({ baseDelay: 10, maxDelay: 1000 })
    
    const d0 = policy.calculateDelay(0)
    const d1 = policy.calculateDelay(1)
    const d2 = policy.calculateDelay(2)

    expect(d0).toBeGreaterThanOrEqual(10)
    expect(d1).toBeGreaterThan(d0)
    expect(d2).toBeGreaterThan(d1)
  })
})

describe("IdempotencyKey", () => {
  let generateIdempotencyKey
  let parseIdempotencyKey

  beforeEach(async () => {
    const module = await import("../../src/core/IdempotencyKey.js")
    generateIdempotencyKey = module.generateIdempotencyKey
    parseIdempotencyKey = module.parseIdempotencyKey
  })

  it("generates valid keys", () => {
    const request = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7
    }

    const key1 = generateIdempotencyKey(request)
    const key2 = generateIdempotencyKey(request)

    expect(key1).toMatch(/^idemp-[a-f0-9]+-\d+-[a-f0-9]+$/)
    expect(key2).toMatch(/^idemp-[a-f0-9]+-\d+-[a-f0-9]+$/)
  })

  it("generates different keys for different requests", () => {
    const key1 = generateIdempotencyKey({ model: "gpt-4", messages: [] })
    const key2 = generateIdempotencyKey({ model: "claude-3", messages: [] })

    expect(key1).not.toBe(key2)
  })

  it("parses key correctly", () => {
    const key = generateIdempotencyKey({ model: "gpt-4", messages: [] })
    const parsed = parseIdempotencyKey(key)

    expect(parsed).not.toBeNull()
    expect(parsed.isValid).toBe(true)
    expect(parsed.hash).toBeDefined()
  })
})
