import mongoose from "mongoose";
import { Invoice, type InvoiceStatus } from "../models/invoice.js";
import { Merchant } from "../models/merchant.js";
import { LedgerEntry } from "../models/ledger-entry.js";
import { AppError } from "../middleware/error.js";
import { verifySignature } from "../lib/hmac.js";
import type { RedisClient } from "../redis.js";

export interface WebhookHeaders {
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
}

export interface WebhookResult {
  ok: true;
  invoiceId: string;
  status: InvoiceStatus;
  idempotent: boolean;
}

interface WebhookDeps {
  redis: RedisClient;
  timestampWindowSec: number;
  clockSkewSec: number;
  now?: () => number;
}

/**
 * Processing order is deliberate:
 *   1. signature  - authenticate before anything else
 *   2. timestamp  - pure check, no state
 *   3. nonce      - first state mutation (Redis SET NX); burning a nonce
 *                   before signature verification would let an
 *                   unauthenticated attacker pre-burn nonces and DoS
 *                   legitimate deliveries
 *   4. transition - atomic state machine + exactly-once credit
 */
export async function processWebhook(
  rawBody: Buffer,
  body: { invoiceId: string; status: "paid" | "failed" },
  headers: WebhookHeaders,
  deps: WebhookDeps
): Promise<WebhookResult> {
  const invoice = await Invoice.findById(body.invoiceId);
  if (!invoice) {
    throw new AppError(404, "invoice_not_found", "Unknown invoiceId");
  }
  const merchant = await Merchant.findById(invoice.merchantId);
  if (!merchant) {
    // Data integrity fault: invoice without a merchant. 500 so the sender retries.
    throw new AppError(500, "merchant_missing", "Invoice merchant not found");
  }

  // 1. Signature: HMAC-SHA256 over the exact raw bytes, constant-time compare.
  if (!headers.signature || !verifySignature(merchant.webhookSecret, rawBody, headers.signature)) {
    throw new AppError(401, "invalid_signature", "Signature verification failed");
  }

  // 2. Timestamp freshness, two-sided (clocks skew in both directions).
  const now = deps.now ? deps.now() : Math.floor(Date.now() / 1000);
  const ts = Number(headers.timestamp);
  if (!headers.timestamp || !Number.isInteger(ts)) {
    throw new AppError(400, "invalid_timestamp", "X-Timestamp must be unix seconds");
  }
  if (Math.abs(now - ts) > deps.timestampWindowSec) {
    throw new AppError(400, "stale_timestamp", "X-Timestamp outside the accepted window");
  }

  // 3. Nonce: atomic check-and-consume. TTL >= timestamp window is mandatory -
  //    a shorter TTL opens a replay gap after the nonce expires while the
  //    timestamp is still fresh. GET+SET would race; SET NX is the only
  //    correct form.
  if (!headers.nonce) {
    throw new AppError(400, "missing_nonce", "X-Nonce header required");
  }
  const nonceTtl = deps.timestampWindowSec + deps.clockSkewSec;
  const claimed = await deps.redis.set(
    `nonce:${merchant._id.toString()}:${headers.nonce}`,
    "1",
    "EX",
    nonceTtl,
    "NX"
  );
  if (claimed === null) {
    throw new AppError(400, "nonce_replayed", "X-Nonce already used");
  }

  // 4. State transition + credit.
  if (body.status === "paid") {
    return creditPaidInvoice(invoice._id, merchant._id);
  }
  return markFailed(invoice._id);
}

/**
 * Exactly-once crediting, two complementary layers:
 *
 *  - findOneAndUpdate({ _id, status: 'pending' }) is atomic on the document:
 *    of N concurrent webhooks exactly one wins the pending->paid transition,
 *    the rest see no match. Never find-then-save - that is a TOCTOU race.
 *  - The ledger insert (unique index on invoiceId) and the balance $inc ride
 *    in the same transaction as the transition, so a crash between "marked
 *    paid" and "credited" cannot lose money. withTransaction may retry its
 *    callback on transient errors, so the callback contains Mongo writes only
 *    (the Redis nonce was consumed before, outside).
 *
 * Duplicates return 200/idempotent: a PSP retries any non-2xx (Stripe - up to
 * 72h, re-signing each attempt), so non-2xx on an already-final invoice is a
 * retry storm. Dedup keys on the invoice, never on signature or nonce.
 */
async function creditPaidInvoice(
  invoiceId: mongoose.Types.ObjectId,
  merchantId: mongoose.Types.ObjectId
): Promise<WebhookResult> {
  const session = await mongoose.startSession();
  try {
    let transitioned = false;
    await session.withTransaction(async () => {
      transitioned = false;
      const updated = await Invoice.findOneAndUpdate(
        { _id: invoiceId, status: "pending" },
        { $set: { status: "paid", paidAt: new Date() } },
        { new: true, session }
      );
      if (!updated) return; // already in a final state - idempotent path

      await LedgerEntry.create(
        [{ invoiceId, merchantId, amount: updated.amountToReceive }],
        { session }
      );
      await Merchant.updateOne(
        { _id: merchantId },
        { $inc: { balance: updated.amountToReceive } },
        { session }
      );
      transitioned = true;
    });

    if (transitioned) {
      return { ok: true, invoiceId: invoiceId.toString(), status: "paid", idempotent: false };
    }
    return idempotentAck(invoiceId, "paid");
  } finally {
    await session.endSession();
  }
}

async function markFailed(invoiceId: mongoose.Types.ObjectId): Promise<WebhookResult> {
  // Single-document update - atomic without a transaction. No crediting on failure.
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: "pending" },
    { $set: { status: "failed", failedAt: new Date() } },
    { new: true }
  );
  if (updated) {
    return { ok: true, invoiceId: invoiceId.toString(), status: "failed", idempotent: false };
  }
  return idempotentAck(invoiceId, "failed");
}

async function idempotentAck(
  invoiceId: mongoose.Types.ObjectId,
  requested: InvoiceStatus
): Promise<WebhookResult> {
  const current = await Invoice.findById(invoiceId);
  if (!current) {
    throw new AppError(404, "invoice_not_found", "Unknown invoiceId");
  }
  if (current.status !== requested) {
    // Sender disagrees with our final state - acknowledge (retrying will
    // never change the outcome) but make it visible.
    console.warn(
      `webhook status conflict: invoice ${invoiceId.toString()} is ${current.status}, sender says ${requested}`
    );
  }
  return { ok: true, invoiceId: invoiceId.toString(), status: current.status, idempotent: true };
}
