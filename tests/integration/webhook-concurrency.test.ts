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

const N = 10;

describe("webhook concurrency", () => {
  it("same nonce x10 in parallel: exactly one passes the nonce gate", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant, 10_000);
    // Byte-identical requests race on the atomic SET NX - this exercises the
    // nonce gate, not crediting (that is the next test).
    const { rawBody, headers } = signWebhook(merchant.webhookSecret, {
      invoiceId: invoice._id.toString(),
      status: "paid",
    });

    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(ctx.app).post("/webhook").set(headers).send(rawBody)
      )
    );

    const accepted = responses.filter((r) => r.status === 200);
    const replayed = responses.filter(
      (r) => r.status === 400 && r.body.error?.code === "nonce_replayed"
    );
    expect(accepted).toHaveLength(1);
    expect(replayed).toHaveLength(N - 1);
    expect(await LedgerEntry.countDocuments({ invoiceId: invoice._id })).toBe(1);
    expect((await Merchant.findById(merchant._id))?.balance).toBe(9_750);
  });

  it("distinct nonces x10, same invoice: exactly one credit", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant, 10_000);
    const payload = { invoiceId: invoice._id.toString(), status: "paid" };

    // Every request passes signature+timestamp+nonce - the race is now purely
    // on the pending->paid transition and the credit. This is the test that
    // kills a find-then-save implementation.
    const requests = Array.from({ length: N }, () => {
      const { rawBody, headers } = signWebhook(merchant.webhookSecret, payload);
      return request(ctx.app).post("/webhook").set(headers).send(rawBody);
    });
    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200); // duplicates are acks, never errors
    }
    const credited = responses.filter((r) => r.body.idempotent === false);
    expect(credited).toHaveLength(1);

    expect(await LedgerEntry.countDocuments({ invoiceId: invoice._id })).toBe(1);
    expect((await Merchant.findById(merchant._id))?.balance).toBe(9_750);
    expect((await Invoice.findById(invoice._id))?.status).toBe("paid");
  });

  it("concurrent paid vs failed: exactly one terminal state, credit consistent with it", async () => {
    const merchant = await seedMerchant();
    const invoice = await seedPendingInvoice(merchant, 10_000);
    const id = invoice._id.toString();

    const paid = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "paid" });
    const failed = signWebhook(merchant.webhookSecret, { invoiceId: id, status: "failed" });

    const [paidRes, failedRes] = await Promise.all([
      request(ctx.app).post("/webhook").set(paid.headers).send(paid.rawBody),
      request(ctx.app).post("/webhook").set(failed.headers).send(failed.rawBody),
    ]);
    expect(paidRes.status).toBe(200);
    expect(failedRes.status).toBe(200);

    const final = await Invoice.findById(invoice._id);
    const ledgerCount = await LedgerEntry.countDocuments({ invoiceId: invoice._id });
    const balance = (await Merchant.findById(merchant._id))?.balance;

    // Whichever won, the money state must be consistent with the final status.
    expect(["paid", "failed"]).toContain(final?.status);
    if (final?.status === "paid") {
      expect(ledgerCount).toBe(1);
      expect(balance).toBe(9_750);
    } else {
      expect(ledgerCount).toBe(0);
      expect(balance).toBe(0);
    }
  });

  it("parallel invoice creations against one merchant stay independent", async () => {
    const merchant = await seedMerchant({ feePercentBp: 333 });
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(ctx.app)
          .post("/invoice")
          .send({ amount: 1_000 + i, currency: "USD", merchantId: merchant._id.toString() })
      )
    );
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.fee + res.body.amountToReceive).toBe(res.body.amount);
    }
    expect(await Invoice.countDocuments()).toBe(N);
  });
});
