import { CircuitBreaker, CircuitState } from './CircuitBreaker.js';

const DEFAULT_OPTIONS = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeout: 60000,
  halfOpenMaxCalls: 1
};

class CircuitBreakerManagerClass {
  constructor() {
    this.circuits = new Map();
    this.options = { ...DEFAULT_OPTIONS };
  }

  configure(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get(providerId, options = {}) {
    if (!this.circuits.has(providerId)) {
      this.circuits.set(
        providerId,
        new CircuitBreaker(providerId, { ...this.options, ...options })
      );
    }
    return this.circuits.get(providerId);
  }

  has(providerId) {
    return this.circuits.has(providerId);
  }

  reset(providerId) {
    if (this.circuits.has(providerId)) {
      this.circuits.get(providerId).reset();
      this.circuits.delete(providerId);
    }
  }

  resetAll() {
    for (const cb of this.circuits.values()) {
      cb.reset();
    }
    this.circuits.clear();
  }

  clear() {
    this.circuits.clear();
  }

  getStats() {
    let closed = 0;
    let open = 0
    let halfOpen = 0
    let totalCalls = 0
    let totalFailures = 0
    let totalSuccesses = 0

    for (const cb of this.circuits.values()) {
      totalCalls += cb.totalCalls
      totalFailures += cb.totalFailures
      totalSuccesses += cb.totalSuccesses

      if (cb.state === CircuitState.CLOSED) closed++
      else if (cb.state === CircuitState.OPEN) open++
      else if (cb.state === CircuitState.HALF_OPEN) halfOpen++
    }

    return {
      total: this.circuits.size,
      closed,
      open,
      halfOpen,
      totalCalls,
      totalFailures,
      totalSuccesses,
      failureRate: totalCalls > 0 ? Number(((totalFailures / totalCalls) * 100).toFixed(2)) : 0
    };
  }

  getHealthyProviders() {
    const healthy = []
    for (const [providerId, circuit] of this.circuits) {
      if (circuit.isClosed()) {
        healthy.push(providerId)
      }
    }
    return healthy
  }

  getUnhealthyProviders() {
    const unhealthy = []
    for (const [providerId, circuit] of this.circuits) {
      if (!circuit.isClosed()) {
        unhealthy.push({
          providerId,
          state: circuit.state,
          lastError: circuit.lastError
        })
      }
    }
    return unhealthy
  }
}

export const circuitBreakerManager = new CircuitBreakerManagerClass()

export function getCircuitBreaker(providerId, options = {}) {
  return circuitBreakerManager.get(providerId, options)
}

export function resetCircuitBreaker(providerId) {
  circuitBreakerManager.reset(providerId)
}

export function resetAllCircuitBreakers() {
  circuitBreakerManager.resetAll()
}

export function getCircuitBreakerStats() {
  return circuitBreakerManager.getStats()
}

