import RedisMock from "ioredis-mock";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { buildApp } from "../../src/app.js";
import { signBody } from "../../src/lib/hmac.js";
import { Merchant } from "../../src/models/merchant.js";
import { Invoice } from "../../src/models/invoice.js";

export const TEST_WINDOW_SEC = 300;
export const TEST_SKEW_SEC = 30;

export interface TestContext {
  app: Express;
  redis: InstanceType<typeof RedisMock>;
}

export function makeTestContext(): TestContext {
  const redis = new RedisMock();
  const app = buildApp({
    redis,
    timestampWindowSec: TEST_WINDOW_SEC,
    clockSkewSec: TEST_SKEW_SEC,
  });
  return { app, redis };
}

export async function seedMerchant(overrides: Partial<{
  name: string;
  feePercentBp: number;
  webhookSecret: string;
  balance: number;
}> = {}) {
  return Merchant.create({
    name: "Test Merchant",
    feePercentBp: 250,
    webhookSecret: "test-webhook-secret",
    balance: 0,
    ...overrides,
  });
}

export async function seedPendingInvoice(
  merchant: Awaited<ReturnType<typeof seedMerchant>>,
  amount = 10_000
) {
  const feePercentBp = merchant.feePercentBp;
  const fee = Math.floor((amount * feePercentBp + 5000) / 10000);
  return Invoice.create({
    merchantId: merchant._id,
    amount,
    currency: "USD",
    fee,
    amountToReceive: amount - fee,
    status: "pending",
  });
}

export interface SignedWebhook {
  rawBody: string;
  headers: Record<string, string>;
}

/**
 * Builds a signed webhook request. The returned rawBody string must be sent
 * verbatim (supertest .send(string)) - the signature covers these exact bytes.
 */
export function signWebhook(
  secret: string,
  payload: object,
  overrides: Partial<{ signature: string; timestamp: string; nonce: string }> = {}
): SignedWebhook {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "x-signature": overrides.signature ?? signBody(secret, rawBody),
      "x-timestamp": overrides.timestamp ?? String(Math.floor(Date.now() / 1000)),
      "x-nonce": overrides.nonce ?? randomUUID(),
    },
  };
}
