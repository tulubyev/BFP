import Redis from 'ioredis';

let client: Redis | null = null;

/**
 * Shared Redis client, or null when REDIS_URL is not set (local dev, tests).
 * Commands queue briefly while connecting (so the first requests after startup hit the cache)
 * but time out after 1s, so a Redis outage only disables caching.
 */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = new Redis(url, {
      enableOfflineQueue: true,
      commandTimeout: 1000,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on('error', err => console.warn('Redis error:', err.message));
    client.on('ready', () => console.log('Redis connected'));
  }
  return client;
}
