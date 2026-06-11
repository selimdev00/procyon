import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { connectTestDb, disconnectTestDb, clearDb } from "../helpers/db.js";
import { makeTestContext, seedMerchant, type TestContext } from "../helpers/app.js";
import { Invoice } from "../../src/models/invoice.js";

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

describe("POST /invoice", () => {
  it("creates a pending invoice with computed fee and amountToReceive", async () => {
    const merchant = await seedMerchant({ feePercentBp: 250 });
    const res = await request(ctx.app)
      .post("/invoice")
      .send({ amount: 10_000, currency: "USD", merchantId: merchant._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: 10_000,
      currency: "USD",
      fee: 250,
      amountToReceive: 9_750,
      status: "pending",
    });
    expect(res.body.invoiceId).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.fee + res.body.amountToReceive).toBe(res.body.amount);

    const stored = await Invoice.findById(res.body.invoiceId);
    expect(stored?.status).toBe("pending");
  });

  it("uses the merchant's own feePercent", async () => {
    const merchant = await seedMerchant({ feePercentBp: 150 });
    const res = await request(ctx.app)
      .post("/invoice")
      .send({ amount: 10_000, currency: "EUR", merchantId: merchant._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.fee).toBe(150);
    expect(res.body.amountToReceive).toBe(9_850);
  });

  it.each([
    ["zero amount", { amount: 0 }],
    ["negative amount", { amount: -100 }],
    ["fractional amount", { amount: 10.5 }],
    ["string amount", { amount: "10000" }],
    ["unsupported currency", { currency: "BTC" }],
    ["malformed merchantId", { merchantId: "not-an-id" }],
    ["missing amount", { amount: undefined }],
  ])("rejects %s with 400", async (_name, override) => {
    const merchant = await seedMerchant();
    const res = await request(ctx.app)
      .post("/invoice")
      .send({
        amount: 10_000,
        currency: "USD",
        merchantId: merchant._id.toString(),
        ...override,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("returns 404 for an unknown merchant", async () => {
    const res = await request(ctx.app)
      .post("/invoice")
      .send({ amount: 10_000, currency: "USD", merchantId: "0".repeat(24) });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("merchant_not_found");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(ctx.app)
      .post("/invoice")
      .set("content-type", "application/json")
      .send('{"amount": 10000,');
    expect(res.status).toBe(400);
  });
});

describe("GET /invoice/:id", () => {
  it("returns the invoice", async () => {
    const merchant = await seedMerchant();
    const created = await request(ctx.app)
      .post("/invoice")
      .send({ amount: 5_000, currency: "RUB", merchantId: merchant._id.toString() });

    const res = await request(ctx.app).get(`/invoice/${created.body.invoiceId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      invoiceId: created.body.invoiceId,
      amount: 5_000,
      status: "pending",
    });
  });

  it.each([
    ["unknown id", "0".repeat(24)],
    ["malformed id", "nope"],
  ])("returns 404 for %s", async (_name, id) => {
    const res = await request(ctx.app).get(`/invoice/${id}`);
    expect(res.status).toBe(404);
  });
});
