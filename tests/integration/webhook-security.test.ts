import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb } from "../helpers/db.js";
import {
  makeTestContext,
  seedMerchant,
  seedPendingInvoice,
  signWebhook,
  TEST_WINDOW_SEC,
  type TestContext,
} from "../helpers/app.js";
import { Invoice } from "../../src/models/invoice.js";
import { LedgerEntry } from "../../src/models/ledger-entry.js";
import { signBody } from "../../src/lib/hmac.js";

let ctx: TestContext;

beforeAll(async () => {
  await connectTestDb();
  ctx = makeTestContext();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
  await ctx.redis.flushall();
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

describe("POST /webhook security", () => {
  it("accepts a correctly signed webhook", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "paid",
    });

    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "paid", idempotent: false });
  });

  it("rejects a tampered body with 401 and changes nothing", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "failed",
    });
    // Flip failed -> paid after signing: signature no longer matches the bytes.
    const tampered = rawBody.replace('"failed"', '"paid"');

    const res = await request(ctx.app).post("/webhook").set(headers).send(tampered);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_signature");
    expect((await Invoice.findById(invoice._id))?.status).toBe("pending");
    expect(await LedgerEntry.countDocuments()).toBe(0);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const merchant = await seedMerchant({ webhookSecret: "right-secret" });
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook("wrong-secret", {
      invoiceId: invoice._id.toString(),
      status: "paid",
    });

    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(401);
    expect((await Invoice.findById(invoice._id))?.status).toBe("pending");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["garbage", "not-hex-at-all"],
  ])("rejects %s signature header with 401", async (_name, sig) => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "paid",
    });
    if (sig === undefined) {
      delete headers["x-signature"];
    } else {
      headers["x-signature"] = sig;
    }

    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp with 400 and accepts the window boundary", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const payload = { invoiceId: invoice._id.toString(), status: "paid" };

    const stale = signWebhook(merchant.webhookSecret, payload, {
      timestamp: String(nowSec() - TEST_WINDOW_SEC - 5),
    });
    const staleRes = await request(ctx.app).post("/webhook").set(stale.headers).send(stale.rawBody);
    expect(staleRes.status).toBe(400);
    expect(staleRes.body.error.code).toBe("stale_timestamp");
    expect((await Invoice.findById(invoice._id))?.status).toBe("pending");

    const boundary = signWebhook(merchant.webhookSecret, payload, {
      timestamp: String(nowSec() - TEST_WINDOW_SEC + 2),
    });
    const okRes = await request(ctx.app).post("/webhook").set(boundary.headers).send(boundary.rawBody);
    expect(okRes.status).toBe(200);
  });

  it("rejects a far-future timestamp (two-sided window)", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(
      merchant.webhookSecret,
      { invoiceId: invoice._id.toString(), status: "paid" },
      { timestamp: String(nowSec() + TEST_WINDOW_SEC + 5) }
    );
    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric timestamp", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(
      merchant.webhookSecret,
      { invoiceId: invoice._id.toString(), status: "paid" },
      { timestamp: "yesterday" }
    );
    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(400);
  });

  it("rejects a reused nonce with 400 and does not double-process", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const payload = { invoiceId: invoice._id.toString(), status: "paid" };
    const nonce = "fixed-nonce-1";

    const first = signWebhook(merchant.webhookSecret, payload, { nonce });
    const firstRes = await request(ctx.app).post("/webhook").set(first.headers).send(first.rawBody);
    expect(firstRes.status).toBe(200);

    const second = signWebhook(merchant.webhookSecret, payload, { nonce });
    const secondRes = await request(ctx.app).post("/webhook").set(second.headers).send(second.rawBody);
    expect(secondRes.status).toBe(400);
    expect(secondRes.body.error.code).toBe("nonce_replayed");
    expect(await LedgerEntry.countDocuments({ invoiceId: invoice._id })).toBe(1);
  });

  it("rejects a missing nonce", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "paid",
    });
    delete headers["x-nonce"];

    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_nonce");
  });

  it("does not burn the nonce on an invalid signature (no pre-burn DoS)", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const payload = { invoiceId: invoice._id.toString(), status: "paid" };
    const nonce = "attacker-guessed-nonce";

    // Unauthenticated attacker tries to pre-burn the nonce.
    const forged = signWebhook("attacker-secret", payload, { nonce });
    const forgedRes = await request(ctx.app).post("/webhook").set(forged.headers).send(forged.rawBody);
    expect(forgedRes.status).toBe(401);

    // The legitimate delivery with the same nonce must still succeed.
    const legit = signWebhook(merchant.webhookSecret, payload, { nonce });
    const legitRes = await request(ctx.app).post("/webhook").set(legit.headers).send(legit.rawBody);
    expect(legitRes.status).toBe(200);
  });

  it("returns 404 for an unknown invoiceId", async () => {
    const { rawBody, headers } = signWebhook("any-secret", {
      invoiceId: "0".repeat(24),
      status: "paid",
    });
    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(404);
  });

  it("rejects an invalid status value with 400", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "refunded",
    });
    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(400);
  });

  it("computes the signature over raw bytes, not re-serialized JSON", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    // Same JSON semantics, different bytes: extra whitespace + key order.
    const rawBody = `{ "status": "paid", "invoiceId": "${invoice._id.toString()}" }`;
    const headers = {
      "content-type": "application/json",
      "x-signature": signBody(merchant.webhookSecret, rawBody),
      "x-timestamp": String(nowSec()),
      "x-nonce": "raw-bytes-nonce",
    };
    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(200);
  });
});
