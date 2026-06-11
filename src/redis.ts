import { Redis } from "ioredis";

// The app receives a client instance (see buildApp) so tests can inject
// ioredis-mock without touching module internals.
export type RedisClient = Pick<Redis, "set" | "quit">;

export function createRedis(url: string): Redis {
  return new Redis(url);
}
