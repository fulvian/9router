import { getMetrics, getContentType } from "@/observability/metrics.js"
import { getCircuitBreakerStats } from "@/core/CircuitBreakerManager.js"
import { getDlqStats } from "@/lib/dlqDb.js"

export async function GET() {
  try {
    const metrics = await getMetrics()
    
    const circuitStats = getCircuitBreakerStats()
    const dlqStats = await getDlqStats()
    
    const customMetrics = `
# HELP ninerouter_circuit_breakers_total Total circuit breakers
# TYPE ninerouter_circuit_breakers_total gauge
ninerouter_circuit_breakers_total{state="closed"} ${circuitStats.closed}
ninerouter_circuit_breakers_total{state="open"} ${circuitStats.open}
ninerouter_circuit_breakers_total{state="half_open"} ${circuitStats.halfOpen}
ninerouter_circuit_breakers_total{state="total"} ${circuitStats.total}

# HELP ninerouter_circuit_failure_rate Circuit breaker failure rate
# TYPE ninerouter_circuit_failure_rate gauge
ninerouter_circuit_failure_rate ${circuitStats.failureRate}

# HELP ninerouter_dlq_entries Dead letter queue entries
# TYPE ninerouter_dlq_entries gauge
ninerouter_dlq_entries{status="pending"} ${dlqStats.pending}
ninerouter_dlq_entries{status="retrying"} ${dlqStats.retrying}
ninerouter_dlq_entries{status="exhausted"} ${dlqStats.exhausted}
ninerouter_dlq_entries{status="archived"} ${dlqStats.archived}
`

    return new Response(metrics + customMetrics, {
      headers: {
        "Content-Type": getContentType(),
        "Cache-Control": "no-cache"
      }
    })
  } catch (error) {
    return new Response(`# Error collecting metrics\n# ${error.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" }
    })
  }
}
