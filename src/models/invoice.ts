import { Schema, model, type InferSchemaType } from "mongoose";

export const INVOICE_STATUSES = ["pending", "paid", "failed"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "RUB"] as const;

const invoiceSchema = new Schema(
  {
    merchantId: { type: Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    // All amounts are integers in minor units. Invariant: fee + amountToReceive === amount.
    amount: { type: Number, required: true },
    currency: { type: String, required: true, enum: SUPPORTED_CURRENCIES },
    fee: { type: Number, required: true },
    amountToReceive: { type: Number, required: true },
    status: { type: String, required: true, enum: INVOICE_STATUSES, default: "pending" },
    paidAt: { type: Date },
    failedAt: { type: Date },
  },
  { timestamps: true }
);

export type InvoiceDoc = InferSchemaType<typeof invoiceSchema>;
export const Invoice = model("Invoice", invoiceSchema);
