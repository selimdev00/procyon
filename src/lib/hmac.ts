import { createHmac, timingSafeEqual } from "node:crypto";

/** Hex HMAC-SHA256 over the exact raw bytes of the payload. */
export function signBody(secret: string, rawBody: Buffer | string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Constant-time signature check.
 *
 * timingSafeEqual throws on length mismatch, so the length guard is not an
 * optimization - without it a garbage header crashes the handler with a 500,
 * an unauthenticated DoS. Buffer.from(x, "hex") silently truncates invalid
 * hex, which the length guard also catches.
 */
export function verifySignature(
  secret: string,
  rawBody: Buffer,
  signatureHex: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signatureHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
