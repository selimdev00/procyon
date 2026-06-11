import { Schema, model, type InferSchemaType } from "mongoose";

const merchantSchema = new Schema(
  {
    name: { type: String, required: true },
    // Fee in basis points (250 = 2.50%) - integer, so fee math never touches floats.
    feePercentBp: { type: Number, required: true, min: 0, max: 10_000 },
    webhookSecret: { type: String, required: true },
    // Balance in minor units, credited exactly once per paid invoice.
    balance: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export type MerchantDoc = InferSchemaType<typeof merchantSchema>;
export const Merchant = model("Merchant", merchantSchema);
