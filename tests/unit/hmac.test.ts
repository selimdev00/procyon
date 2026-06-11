import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "../../src/lib/hmac.js";

const SECRET = "test-secret";

describe("hmac sign/verify", () => {
  it("verifies a signature over the exact raw bytes", () => {
    const raw = Buffer.from('{"invoiceId":"abc","status":"paid"}');
    const sig = signBody(SECRET, raw);
    expect(verifySignature(SECRET, raw, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const raw = Buffer.from('{"invoiceId":"abc","status":"paid"}');
    const sig = signBody(SECRET, raw);
    const tampered = Buffer.from('{"invoiceId":"abc","status":"PAID"}');
    expect(verifySignature(SECRET, tampered, sig)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const raw = Buffer.from("{}");
    const sig = signBody("other-secret", raw);
    expect(verifySignature(SECRET, raw, sig)).toBe(false);
  });

  it("is sensitive to whitespace and key order (raw bytes, not JSON semantics)", () => {
    const a = Buffer.from('{"a":1,"b":2}');
    const b = Buffer.from('{"b":2,"a":1}');
    expect(verifySignature(SECRET, b, signBody(SECRET, a))).toBe(false);
  });

  it.each([
    ["empty string", ""],
    ["garbage non-hex", "zzzz-not-hex"],
    ["valid hex, wrong length", "deadbeef"],
    ["one hex digit short", "a".repeat(63)],
  ])("does not throw on malformed signature header: %s", (_name, sig) => {
    const raw = Buffer.from("{}");
    expect(verifySignature(SECRET, raw, sig)).toBe(false);
  });
});
