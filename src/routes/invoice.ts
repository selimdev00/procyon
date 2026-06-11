import { Router } from "express";
import { z } from "zod";
import { createInvoice, getInvoice } from "../services/invoice.js";
import { MAX_AMOUNT } from "../lib/money.js";
import { SUPPORTED_CURRENCIES } from "../models/invoice.js";

const createInvoiceSchema = z.object({
  amount: z
    .number({ error: "amount must be a number" })
    .int({ error: "amount must be an integer in minor units" })
    .positive({ error: "amount must be positive" })
    .max(MAX_AMOUNT, { error: `amount must be <= ${MAX_AMOUNT}` }),
  currency: z.enum(SUPPORTED_CURRENCIES, { error: "unsupported currency" }),
  merchantId: z
    .string({ error: "merchantId must be a string" })
    .regex(/^[0-9a-fA-F]{24}$/, { error: "merchantId must be a 24-char hex id" }),
});

export const invoiceRouter = Router();

invoiceRouter.post("/", async (req, res) => {
  // Express 5: req.body is undefined when the parser did not run.
  const input = createInvoiceSchema.parse(req.body ?? {});
  const invoice = await createInvoice(input);
  res.status(201).json(invoice);
});

invoiceRouter.get("/:id", async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  res.json(invoice);
});
