const OTEL_ENABLED = process.env.OTEL_ENABLED === "true"
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"

let tracer = null
let span = null

if (OTEL_ENABLED) {
  try {
    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node")
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http")
    const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base")
    const { Resource } = require("@opentelemetry/resources")
    const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions")

    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: "ninerouter",
        [SemanticResourceAttributes.SERVICE_VERSION]: "0.2.82"
      })
    })

    const exporter = new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`
    })

    provider.addSpanProcessor(new BatchSpanProcessor(exporter))
    provider.register()

    tracer = provider.getTracer("ninerouter", "0.2.82")
    console.log("[Tracer] OpenTelemetry initialized")
  } catch (error) {
    console.warn("[Tracer] OpenTelemetry not available:", error.message)
  }
}

export function isTracingEnabled() {
  return OTEL_ENABLED && tracer !== null
}

export function getTracer() {
  return tracer
}

export async function withSpan(name, fn, attributes = {}) {
  if (!isTracingEnabled()) {
    return fn(null)
  }

  return tracer.startActiveSpan(name, { attributes }, async (activeSpan) => {
    try {
      const result = await fn(activeSpan)
      activeSpan.setStatus({ code: 0 })
      return result
    } catch (error) {
      activeSpan.recordException(error)
      activeSpan.setStatus({ code: 2, message: error.message })
      throw error
    } finally {
      activeSpan.end()
    }
  })
}

export function addSpanAttributes(attrs) {
  if (!isTracingEnabled()) return
  const activeSpan = tracer.getActiveSpan?.()
  if (activeSpan) {
    activeSpan.setAttributes(attrs)
  }
}

export function addSpanEvent(name, attributes = {}) {
  if (!isTracingEnabled()) return
  const activeSpan = tracer.getActiveSpan?.()
  if (activeSpan) {
    activeSpan.addEvent(name, attributes)
  }
}

export { tracer }
export default { withSpan, addSpanAttributes, addSpanEvent, isTracingEnabled, getTracer }
