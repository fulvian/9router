import { semanticCache } from "../persistence/cache.js"
import { trackCacheHit, trackCacheMiss } from "../observability/metrics.js"
import { chatLogger } from "../observability/logger.js"

const SEMANTIC_CACHE_ENABLED = process.env.SEMANTIC_CACHE_ENABLED === "true"
const SIMILARITY_THRESHOLD = parseFloat(process.env.SEMANTIC_SIMILARITY_THRESHOLD || "0.95")
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small"

let embeddingClient = null

export function setEmbeddingClient(client) {
  embeddingClient = client
  chatLogger.info({ event: "embedding_client_set", model: EMBEDDING_MODEL })
}

export function isSemanticCacheEnabled() {
  return SEMANTIC_CACHE_ENABLED && embeddingClient !== null
}

async function getEmbedding(text) {
  if (!embeddingClient) {
    return null
  }

  try {
    const truncated = text.slice(0, 8000)

    const response = await embeddingClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncated
    })

    return response.data[0].embedding
  } catch (error) {
    chatLogger.warn({ event: "embedding_failed", error: error.message })
    return null
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 1

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

function extractQueryText(request) {
  const messages = request.messages || []
  if (messages.length === 0) return ""

  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return ""

  if (typeof lastMessage.content === "string") {
    return lastMessage.content
  }

  if (Array.isArray(lastMessage.content)) {
    const textParts = lastMessage.content
      .filter(part => part.type === "text")
      .map(part => part.text || "")
    return textParts.join(" ")
  }

  return ""
}

export async function findSimilarCachedResponse(request) {
  if (!isSemanticCacheEnabled()) {
    return null
  }

  const queryText = extractQueryText(request)
  if (!queryText || queryText.length < 10) {
    return null
  }

  const queryEmbedding = await getEmbedding(queryText)
  if (!queryEmbedding) {
    return null
  }

  const model = request.model
  const indexKey = `index:${model}`

  try {
    const keys = await semanticCache.get(indexKey) || []

    let bestMatch = null
    let bestSimilarity = 0

    for (const key of keys) {
      const cached = await semanticCache.get(key)
      if (!cached) continue

      const similarity = cosineSimilarity(queryEmbedding, cached.embedding)

      if (similarity >= SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = {
          response: cached.response,
          similarity,
          cachedAt: cached.cachedAt
        }
      }
    }

    if (bestMatch) {
      trackCacheHit("semantic", model)
      chatLogger.info({
        event: "semantic_cache_hit",
        model,
        similarity: bestMatch.similarity.toFixed(3),
        queryLength: queryText.length
      })
      return bestMatch
    }

    trackCacheMiss("semantic", model)
    return null
  } catch (error) {
    chatLogger.error({ event: "semantic_cache_error", error: error.message })
    return null
  }
}

export async function cacheSemanticResponse(request, response) {
  if (!isSemanticCacheEnabled()) return
  if (!response) return

  const queryText = extractQueryText(request)
  if (!queryText || queryText.length < 10) return

  const embedding = await getEmbedding(queryText)
  if (!embedding) return

  const model = request.model
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const key = `${model}:${timestamp}:${random}`

  try {
    await semanticCache.set(key, {
      embedding,
      response,
      cachedAt: new Date().toISOString(),
      queryPreview: queryText.slice(0, 100)
    }, 300000)

    const indexKey = `index:${model}`
    const keys = await semanticCache.get(indexKey) || []
    keys.push(key)

    const trimmedKeys = keys.slice(-100)
    await semanticCache.set(indexKey, trimmedKeys, 300000)

    chatLogger.debug({
      event: "semantic_cache_stored",
      model,
      key,
      indexSize: trimmedKeys.length
    })
  } catch (error) {
    chatLogger.error({ event: "semantic_cache_store_error", error: error.message })
  }
}

export async function clearSemanticCache(model = null) {
  try {
    if (model) {
      const indexKey = `index:${model}`
      const keys = await semanticCache.get(indexKey) || []

      for (const key of keys) {
        await semanticCache.delete(key)
      }

      await semanticCache.delete(indexKey)
      chatLogger.info({ event: "semantic_cache_cleared", model })
    } else {
      await semanticCache.clear()
      chatLogger.info({ event: "semantic_cache_cleared_all" })
    }
  } catch (error) {
    chatLogger.error({ event: "semantic_cache_clear_error", error: error.message })
  }
}

export function getSemanticCacheStats() {
  return semanticCache.stats()
}

export default {
  findSimilarCachedResponse,
  cacheSemanticResponse,
  clearSemanticCache,
  getSemanticCacheStats,
  setEmbeddingClient,
  isSemanticCacheEnabled
}
