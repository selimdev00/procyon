import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb } from "../helpers/db.js";
import {
  makeTestContext,
  seedMerchant,
  seedPendingInvoice,
  signWebhook,
  type TestContext,
} from "../helpers/app.js";
import { Invoice } from "../../src/models/invoice.js";
import { LedgerEntry } from "../../src/models/ledger-entry.js";
import { Merchant } from "../../src/models/merchant.js";

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

describe("webhook idempotency (duplicate delivery)", () => {
  it("credits exactly once when the same paid webhook is delivered twice", async () => {
    const merchant = await seedMerchant({ feePercentBp: 250 });
    const invoice = await seedPendingInvoice(merchant, 10_000); // amountToReceive 9750
    const payload = { invoiceId: invoice._id.toString(), status: "paid" };

    // PSPs re-sign retries: each delivery carries a fresh nonce + timestamp.
    const first = signWebhook(merchant.webhookSecret, payload);
    const firstRes = await request(ctx.app).post("/webhook").set(first.headers).send(first.rawBody);
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.idempotent).toBe(false);

    const second = signWebhook(merchant.webhookSecret, payload);
    const secondRes = await request(ctx.app).post("/webhook").set(second.headers).send(second.rawBody);
    expect(secondRes.status).toBe(200); // 2xx, or the PSP retries forever
    expect(secondRes.body.idempotent).toBe(true);

    expect(await LedgerEntry.countDocuments({ invoiceId: invoice._id })).toBe(1);
    expect((await Merchant.findById(merchant._id))?.balance).toBe(9_750);
    expect((await Invoice.findById(invoice._id))?.status).toBe("paid");
  });

  it("marks an invoice failed without any crediting", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "failed",
    });

    const res = await request(ctx.app).post("/webhook").set(headers).send(rawBody);
    expect(res.status).toBe(200);
    expect((await Invoice.findById(invoice._id))?.status).toBe("failed");
    expect(await LedgerEntry.countDocuments()).toBe(0);
    expect((await Merchant.findById(merchant._id))?.balance).toBe(0);
  });

  it("keeps a paid invoice paid when a conflicting failed webhook arrives", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant, 10_000);
    const id = invoice._id.toString();

    const paid = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "paid" });
    await request(ctx.app).post("/webhook").set(paid.headers).send(paid.rawBody);

    const failed = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "failed" });
    const res = await request(ctx.app).post("/webhook").set(failed.headers).send(failed.rawBody);

    // Terminal states never transition; ack with 200 so the sender stops retrying.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ idempotent: true, status: "paid" });
    expect((await Invoice.findById(invoice._id))?.status).toBe("paid");
    expect((await Merchant.findById(merchant._id))?.balance).toBe(9_750);
  });

  it("never credits a failed invoice on a late paid webhook", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant);
    const id = invoice._id.toString();

    const failed = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "failed" });
    await request(ctx.app).post("/webhook").set(failed.headers).send(failed.rawBody);

    const paid = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "paid" });
    const res = await request(ctx.app).post("/webhook").set(paid.headers).send(paid.rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ idempotent: true, status: "failed" });
    expect(await LedgerEntry.countDocuments()).toBe(0);
    expect((await Merchant.findById(merchant._id))?.balance).toBe(0);
  });
});
