import express from "express";
import { invoiceRouter } from "./routes/invoice.js";
import { webhookRouter, type WebhookRouterDeps } from "./routes/webhook.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Exact raw bytes of the request body; HMAC must be computed over these. */
    rawBody?: Buffer;
  }
}

export type AppDeps = WebhookRouterDeps;

export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        // Keep the raw Buffer: re-serializing req.body changes key order and
        // whitespace, which breaks HMAC verification against other clients.
        (req as express.Request).rawBody = buf;
      },
    })
  );

  app.use("/invoice", invoiceRouter);
  app.use("/webhook", webhookRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
