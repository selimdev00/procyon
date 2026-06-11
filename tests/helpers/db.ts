import { inject } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
// Register all models on the connection before init().
import "../../src/models/merchant.js";
import "../../src/models/invoice.js";
import "../../src/models/ledger-entry.js";

export async function connectTestDb(): Promise<void> {
  // Unique database per test file: parallel files share one in-memory
  // replica set without stepping on each other.
  const dbName = `test_${randomUUID().slice(0, 8)}`;
  await mongoose.connect(inject("MONGO_URI"), { dbName });
  // unique:true is an index, not a validator - index builds are async and a
  // duplicate written before the build completes does NOT error. init()
  // awaits the build so unique-constraint tests are meaningful.
  await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
}

export async function clearDb(): Promise<void> {
  // deleteMany keeps indexes; dropDatabase would destroy them and reopen
  // the unique-index race between tests.
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
