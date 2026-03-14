export { logger, createContextLogger, createRequestLogger, authLogger, chatLogger, routerLogger, providerLogger, circuitLogger, dlqLogger } from "./logger.js"
export { 
  requestsTotal, 
  requestDuration, 
  tokensTotal, 
  costDollars, 
  fallbackTotal,
  circuitState,
  activeRequests,
  cacheHits,
  cacheMisses,
  dlqSize,
  trackRequest,
  trackRequestDuration,
  trackTokens,
  trackCost,
  trackFallback,
  updateCircuitState,
  setActiveRequests,
  trackCacheHit,
  trackCacheMiss,
  updateDlqSize,
  getMetrics,
  getContentType,
  REGISTER
} from "./metrics.js"
export { tracer, withSpan, addSpanAttributes, addSpanEvent, isTracingEnabled, getTracer } from "./tracer.js"
