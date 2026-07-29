import Redis from 'ioredis';
import { config } from './index.js';

export const redis = new Redis(config.redis.url, { lazyConnect: false });

// Presencia: clave por usuario con TTL renovado por heartbeat del socket
export const presence = {
  key: (userId) => `presence:${userId}`,
  async set(userId, status, ttl = 60) {
    await redis.set(this.key(userId), status, 'EX', ttl);
  },
  async get(userId) {
    return (await redis.get(this.key(userId))) || 'offline';
  },
  // Presencia de varios usuarios en una sola ida a Redis
  async mget(userIds) {
    if (!userIds.length) return {};
    const vals = await redis.mget(userIds.map((id) => this.key(id)));
    return Object.fromEntries(userIds.map((id, i) => [id, vals[i] || 'offline']));
  },
};
