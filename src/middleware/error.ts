import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies the error handler by arity - the 4th param must stay.
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: "Invalid request", issues: err.issues },
    });
    return;
  }
  // Malformed JSON from express.json
  if (err instanceof SyntaxError && "status" in err && err.status === 400) {
    res.status(400).json({ error: { code: "invalid_json", message: "Malformed JSON body" } });
    return;
  }
  console.error("Unhandled error:", err);
  // 500 deliberately: a PSP retries non-2xx, which is what we want for transient faults.
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
}
