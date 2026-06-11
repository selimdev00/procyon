import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { connectMongo, disconnectMongo } from "../src/db.js";
import { Merchant } from "../src/models/merchant.js";

const config = loadConfig();

async function seed() {
  await connectMongo(config.MONGO_URI);

  const merchants = [
    { name: "Acme Store", feePercentBp: 250 }, // 2.50%
    { name: "Globex Market", feePercentBp: 150 }, // 1.50%
  ];

  for (const m of merchants) {
    const existing = await Merchant.findOne({ name: m.name });
    if (existing) {
      console.log(`exists: ${m.name} id=${existing._id} secret=${existing.webhookSecret}`);
      continue;
    }
    const created = await Merchant.create({
      ...m,
      webhookSecret: randomBytes(32).toString("hex"),
      balance: 0,
    });
    console.log(`created: ${m.name} id=${created._id} secret=${created.webhookSecret}`);
  }

  await disconnectMongo();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
