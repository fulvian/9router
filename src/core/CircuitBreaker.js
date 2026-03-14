export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
}

export class CircuitOpenError extends Error {
  constructor(providerId, timeUntilReset) {
    super(`Circuit OPEN for provider "${providerId}". Reset in ${Math.ceil(timeUntilReset / 1000)}s`)
    this.name = 'CircuitOpenError'
    this.providerId = providerId
    this.timeUntilReset = timeUntilReset
    this.isCircuitOpen = true
  }
}

export class CircuitBreaker {
  constructor(providerId, options = {}) {
    this.providerId = providerId
    this.failureThreshold = options.failureThreshold ?? 5
    this.successThreshold = options.successThreshold ?? 2
    this.resetTimeout = options.resetTimeout ?? 60000
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1

    this.state = CircuitState.CLOSED
    this.failures = 0
    this.successes = 0
    this.openedAt = null
    this.lastError = null
    this.halfOpenCalls = 0
    this.totalCalls = 0
    this.totalFailures = 0
    this.totalSuccesses = 0
  }

  async execute(fn) {
    this.totalCalls++

    if (this.state === CircuitState.OPEN) {
      const timeSinceOpen = Date.now() - this.openedAt

      if (timeSinceOpen >= this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN
        this.successes = 0
        this.halfOpenCalls = 0
      } else {
        const timeUntilReset = this.resetTimeout - timeSinceOpen
        throw new CircuitOpenError(this.providerId, timeUntilReset)
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        throw new CircuitOpenError(this.providerId, this.getTimeUntilReset())
      }
      this.halfOpenCalls++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure(error)
      throw error
    }
  }

  onSuccess() {
    this.failures = 0
    this.totalSuccesses++

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++
      if (this.successes >= this.successThreshold) {
        this.state = CircuitState.CLOSED
        this.halfOpenCalls = 0
      }
    }
  }

  onFailure(error) {
    this.failures++
    this.totalFailures++
    this.lastError = {
      message: error?.message || 'Unknown error',
      status: error?.status || error?.statusCode,
      timestamp: new Date().toISOString()
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN
      this.openedAt = Date.now()
    } else if (this.failures >= this.failureThreshold) {
      this.state = CircuitState.OPEN
      this.openedAt = Date.now()
    }
  }

  getTimeUntilReset() {
    if (this.state !== CircuitState.OPEN || !this.openedAt) {
      return 0
    }
    const elapsed = Date.now() - this.openedAt
    return Math.max(0, this.resetTimeout - elapsed)
  }

  getState() {
    return {
      providerId: this.providerId,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      lastError: this.lastError,
      timeUntilReset: this.getTimeUntilReset(),
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      openedAt: this.openedAt
    }
  }

  reset() {
    this.state = CircuitState.CLOSED
    this.failures = 0
    this.successes = 0
    this.openedAt = null
    this.lastError = null
    this.halfOpenCalls = 0
  }

  forceOpen() {
    this.state = CircuitState.OPEN
    this.openedAt = Date.now()
  }

  isClosed() {
    return this.state === CircuitState.CLOSED
  }

  isOpen() {
    return this.state === CircuitState.OPEN
  }

  isHalfOpen() {
    return this.state === CircuitState.HALF_OPEN
  }
}

export default CircuitBreaker
