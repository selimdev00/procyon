import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

// Transactions require a replica set; a single in-memory node is enough.
// One replset per run, each test file connects to its own database name.
let replSet: MongoMemoryReplSet;

export async function setup(project: TestProject) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide("MONGO_URI", replSet.getUri());
}

export async function teardown() {
  await replSet.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    MONGO_URI: string;
  }
}
