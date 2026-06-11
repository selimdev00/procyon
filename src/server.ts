import { config } from "./config.js";
import { connectMongo } from "./db.js";
import { createRedis } from "./redis.js";
import { buildApp } from "./app.js";

async function main() {
  await connectMongo(config.MONGO_URI);
  const redis = createRedis(config.REDIS_URL);

  const app = buildApp({
    redis,
    timestampWindowSec: config.TIMESTAMP_WINDOW_SEC,
    clockSkewSec: config.CLOCK_SKEW_SEC,
  });

  app.listen(config.PORT, () => {
    console.log(`procyon listening on :${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
