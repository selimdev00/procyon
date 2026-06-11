import { Types } from "mongoose";
import { Invoice } from "../models/invoice.js";
import { Merchant } from "../models/merchant.js";
import { splitAmount } from "../lib/money.js";
import { AppError } from "../middleware/error.js";

export interface CreateInvoiceInput {
  amount: number;
  currency: string;
  merchantId: string;
}

export async function createInvoice(input: CreateInvoiceInput) {
  const merchant = await Merchant.findById(input.merchantId);
  if (!merchant) {
    throw new AppError(404, "merchant_not_found", "Unknown merchantId");
  }

  const { fee, amountToReceive } = splitAmount(input.amount, merchant.feePercentBp);

  const invoice = await Invoice.create({
    merchantId: merchant._id,
    amount: input.amount,
    currency: input.currency,
    fee,
    amountToReceive,
    status: "pending",
  });

  return toPublicInvoice(invoice);
}

export async function getInvoice(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(404, "invoice_not_found", "Unknown invoice id");
  }
  const invoice = await Invoice.findById(id);
  if (!invoice) {
    throw new AppError(404, "invoice_not_found", "Unknown invoice id");
  }
  return toPublicInvoice(invoice);
}

function toPublicInvoice(invoice: InstanceType<typeof Invoice>) {
  return {
    invoiceId: invoice._id.toString(),
    merchantId: invoice.merchantId.toString(),
    amount: invoice.amount,
    currency: invoice.currency,
    fee: invoice.fee,
    amountToReceive: invoice.amountToReceive,
    status: invoice.status,
    createdAt: invoice.createdAt,
  };
}
