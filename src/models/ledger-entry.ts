import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * One credit per paid invoice. The unique index on invoiceId is the
 * database-level second line of defense against double crediting: even if
 * application logic raced, the second insert dies on E11000.
 */
const ledgerEntrySchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, unique: true },
    merchantId: { type: Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);

export type LedgerEntryDoc = InferSchemaType<typeof ledgerEntrySchema>;
export const LedgerEntry = model("LedgerEntry", ledgerEntrySchema);
