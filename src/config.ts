import { z } from "zod";

const envSchema = z.object({
  MONGO_URI: z
    .string()
    .default("mongodb://127.0.0.1:27017/procyon?replicaSet=rs0&directConnection=true"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  PORT: z.coerce.number().int().positive().default(3000),
  TIMESTAMP_WINDOW_SEC: z.coerce.number().int().positive().default(300),
  CLOCK_SKEW_SEC: z.coerce.number().int().nonnegative().default(30),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}

export const config = loadConfig();
