export { getRedis, isRedisEnabled, closeRedis, redisHealthCheck, getRedisStats } from "./redis.client.js"
export { Cache, configCache, credentialsCache, semanticCache } from "./cache.js"

export const TTL = {
  config: 5000,
  credentials: 5000,
  models: 60000,
  semantic: 300000,
  health: 10000
}
