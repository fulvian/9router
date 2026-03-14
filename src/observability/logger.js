import pino from "pino"

const isDev = process.env.NODE_ENV !== "production"
const LOG_LEVEL = process.env.LOG_LEVEL || (isDev ? "debug" : "info")

const SENSITIVE_FIELDS = [
  "accessToken",
  "refreshToken", 
  "apiKey",
  "password",
  "secret",
  "token",
  "authorization",
  "x-api-key"
]

function redactPath(path) {
  for (const field of SENSITIVE_FIELDS) {
    if (path.toLowerCase().includes(field.toLowerCase())) {
      return true
    }
  }
  return false
}

const redactPaths = [
  "headers.authorization",
  "headers['x-api-key']",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.password",
  "*.secret",
  "credentials.accessToken",
  "credentials.refreshToken",
  "credentials.apiKey"
]

export const logger = pino({
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]"
  },
  transport: isDev ? {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname"
    }
  } : undefined,
  formatters: {
    level: (label) => ({ level: label })
  }
})

export function createContextLogger(context = {}) {
  return logger.child(context)
}

export function createRequestLogger(requestId, additionalContext = {}) {
  return logger.child({
    requestId,
    ...additionalContext
  })
}

export const authLogger = createContextLogger({ component: "auth" })
export const chatLogger = createContextLogger({ component: "chat" })
export const routerLogger = createContextLogger({ component: "router" })
export const providerLogger = createContextLogger({ component: "provider" })
export const circuitLogger = createContextLogger({ component: "circuit" })
export const dlqLogger = createContextLogger({ component: "dlq" })

export default logger
