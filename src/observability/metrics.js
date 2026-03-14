import client from "prom-client"

const REGISTER = new client.Registry()

client.collectDefaultMetrics({ register: REGISTER })

export const requestsTotal = new client.Counter({
  name: "ninerouter_requests_total",
  help: "Total number of requests processed",
  labelNames: ["provider", "model", "status", "tier"],
  registers: [REGISTER]
})

export const requestDuration = new client.Histogram({
  name: "ninerouter_request_duration_seconds",
  help: "Request duration in seconds",
  labelNames: ["provider", "model"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [REGISTER]
})

export const tokensTotal = new client.Counter({
  name: "ninerouter_tokens_total",
  help: "Total tokens processed",
  labelNames: ["provider", "model", "type"],
  registers: [REGISTER]
})

export const costDollars = new client.Counter({
  name: "ninerouter_cost_dollars_total",
  help: "Total cost in dollars",
  labelNames: ["provider", "model"],
  registers: [REGISTER]
})

export const fallbackTotal = new client.Counter({
  name: "ninerouter_fallback_total",
  help: "Total fallback events",
  labelNames: ["from_provider", "to_provider", "reason"],
  registers: [REGISTER]
})

export const circuitState = new client.Gauge({
  name: "ninerouter_circuit_state",
  help: "Circuit breaker state (0=closed, 1=open, 2=half_open)",
  labelNames: ["provider"],
  registers: [REGISTER]
})

export const activeRequests = new client.Gauge({
  name: "ninerouter_active_requests",
  help: "Number of active requests",
  labelNames: ["provider"],
  registers: [REGISTER]
})

export const cacheHits = new client.Counter({
  name: "ninerouter_cache_hits_total",
  help: "Total cache hits",
  labelNames: ["type"],
  registers: [REGISTER]
})

export const cacheMisses = new client.Counter({
  name: "ninerouter_cache_misses_total",
  help: "Total cache misses",
  labelNames: ["type"],
  registers: [REGISTER]
})

export const dlqSize = new client.Gauge({
  name: "ninerouter_dlq_size",
  help: "Number of entries in dead letter queue",
  labelNames: ["status"],
  registers: [REGISTER]
})

export function trackRequest(provider, model, status, tier = "subscription") {
  requestsTotal.inc({ provider, model, status, tier })
}

export function trackRequestDuration(provider, model, durationSeconds) {
  requestDuration.observe({ provider, model }, durationSeconds)
}

export function trackTokens(provider, model, promptTokens, completionTokens) {
  if (promptTokens > 0) {
    tokensTotal.inc({ provider, model, type: "prompt" }, promptTokens)
  }
  if (completionTokens > 0) {
    tokensTotal.inc({ provider, model, type: "completion" }, completionTokens)
  }
}

export function trackCost(provider, model, cost) {
  if (cost > 0) {
    costDollars.inc({ provider, model }, cost)
  }
}

export function trackFallback(fromProvider, toProvider, reason) {
  fallbackTotal.inc({ from_provider: fromProvider, to_provider: toProvider, reason })
}

export function updateCircuitState(provider, state) {
  const stateValue = state === "CLOSED" ? 0 : state === "OPEN" ? 1 : 2
  circuitState.set({ provider }, stateValue)
}

export function setActiveRequests(provider, count) {
  activeRequests.set({ provider }, count)
}

export function trackCacheHit(type = "semantic", model = "unknown") {
  cacheHits.inc({ type })
}

export function trackCacheMiss(type = "semantic", model = "unknown") {
  cacheMisses.inc({ type })
}

export function updateDlqSize(pending, retrying, exhausted) {
  dlqSize.set({ status: "pending" }, pending)
  dlqSize.set({ status: "retrying" }, retrying)
  dlqSize.set({ status: "exhausted" }, exhausted)
}

export async function getMetrics() {
  return REGISTER.metrics()
}

export function getContentType() {
  return REGISTER.contentType
}

export { REGISTER }
