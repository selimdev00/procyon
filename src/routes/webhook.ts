import { Router } from "express";
import { z } from "zod";
import { processWebhook } from "../services/webhook.js";
import { AppError } from "../middleware/error.js";
import type { RedisClient } from "../redis.js";

const webhookSchema = z.object({
  invoiceId: z
    .string({ error: "invoiceId must be a string" })
    .regex(/^[0-9a-fA-F]{24}$/, { error: "invoiceId must be a 24-char hex id" }),
  status: z.enum(["paid", "failed"], { error: "status must be paid or failed" }),
});

export interface WebhookRouterDeps {
  redis: RedisClient;
  timestampWindowSec: number;
  clockSkewSec: number;
  now?: () => number;
}

export function webhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    // rawBody is set by the express.json verify hook only when a JSON body
    // was actually parsed. Missing raw body = nothing was signed = reject;
    // never "skip the check".
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new AppError(401, "invalid_signature", "Missing JSON body for signature verification");
    }
    const body = webhookSchema.parse(req.body ?? {});
    const result = await processWebhook(
      rawBody,
      body,
      {
        signature: req.get("x-signature"),
        timestamp: req.get("x-timestamp"),
        nonce: req.get("x-nonce"),
      },
      deps
    );
    res.json(result);
  });

  return router;
}
