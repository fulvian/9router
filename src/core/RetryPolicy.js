export class RetryExhaustedError extends Error {
  constructor(attempts, lastError) {
    super(`Retry exhausted after ${attempts} attempts`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export class RetryPolicy {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelay = options.baseDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 5000;
    this.jitterFactor = options.jitterFactor ?? 0.5;
    this.exponentialBase = options.exponentialBase ?? 2;
    this.shouldRetry = options.shouldRetry ?? this.defaultShouldRetry;
  }

  defaultShouldRetry(error, attempt) {
    if (error?.name === 'CircuitOpenError') {
      return false;
    }
    
    const retryableStatuses = [429, 500, 502, 503, 504];
    const status = error?.status || error?.statusCode;
    
    if (retryableStatuses.includes(status)) {
      return true;
    }

    const transientErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'fetch failed',
      'network',
      'timeout'
    ];
    
    const errorMsg = (error?.message || '').toLowerCase();
    if (transientErrors.some(te => errorMsg.includes(te.toLowerCase()))) {
      return true;
    }
    
    return false;
  }

  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(this.exponentialBase, attempt);
    const jitter = exponentialDelay * this.jitterFactor * Math.random();
    const totalDelay = exponentialDelay + jitter;
    return Math.min(totalDelay, this.maxDelay);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async execute(fn, context = {}) {
    let lastError;
    const attempts = [];
    
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const attemptStart = Date.now();
      
      try {
        const result = await fn(attempt);
        
        attempts.push({
          attempt,
          success: true,
          duration: Date.now() - attemptStart
        });
        
        return {
          result,
          attempts,
          totalAttempts: attempt + 1
        };
      } catch (error) {
        lastError = error;
        
        attempts.push({
          attempt,
          success: false,
          error: error.message,
          status: error?.status || error?.statusCode,
          duration: Date.now() - attemptStart
        });

        const isLastAttempt = attempt === this.maxAttempts - 1;
        const shouldRetry = this.shouldRetry(error, attempt);
        
        if (isLastAttempt || !shouldRetry) {
          break;
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw new RetryExhaustedError(this.maxAttempts, lastError);
  }

  withCircuitBreaker(circuitBreaker) {
    return {
      execute: async (fn, context = {}) => {
        return this.execute(async (attempt) => {
          return circuitBreaker.execute(fn);
        }, context);
      }
    };
  }
}

export class NoRetryPolicy extends RetryPolicy {
  constructor() {
    super({ maxAttempts: 1 });
  }
}

export class AggressiveRetryPolicy extends RetryPolicy {
  constructor() {
    super({
      maxAttempts: 5,
      baseDelay: 50,
      maxDelay: 2000,
      jitterFactor: 0.3
    });
  }
}

export class ConservativeRetryPolicy extends RetryPolicy {
  constructor() {
    super({
      maxAttempts: 3,
      baseDelay: 500,
      maxDelay: 10000,
      jitterFactor: 0.2
    });
  }
}

export const defaultRetryPolicy = new RetryPolicy();
export const noRetryPolicy = new NoRetryPolicy();
export const aggressiveRetryPolicy = new AggressiveRetryPolicy();
export const conservativeRetryPolicy = new ConservativeRetryPolicy();

export default RetryPolicy;
