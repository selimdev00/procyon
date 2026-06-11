/**
 * All monetary amounts in the system are integers in minor units
 * (kopecks/cents). Floating point is never used on money paths:
 * 0.1 + 0.2 !== 0.3, and a payment service cannot afford that.
 *
 * Fee percent is stored in basis points (1 bp = 0.01%), so the fee
 * computation stays in integer arithmetic end to end.
 */

const BP_DENOMINATOR = 10_000n;

/** Largest amount we accept; keeps amount * feePercentBp inside safe range with margin. */
export const MAX_AMOUNT = 1_000_000_000_000; // 10^12 minor units

export function assertValidAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new RangeError(`amount must be a positive integer <= ${MAX_AMOUNT}, got ${amount}`);
  }
}

export function assertValidFeePercentBp(feePercentBp: number): void {
  if (!Number.isSafeInteger(feePercentBp) || feePercentBp < 0 || feePercentBp > 10_000) {
    throw new RangeError(`feePercentBp must be an integer in [0, 10000], got ${feePercentBp}`);
  }
}

/**
 * fee = amount * feePercentBp / 10000, rounded half-up.
 *
 * Half-up is the common processor default; the important part is that the
 * rule is explicit and tested at the .5 boundary. Computed via bigint so
 * there is no float anywhere, then narrowed back (range-checked by the
 * amount guard above).
 */
export function calculateFee(amount: number, feePercentBp: number): number {
  assertValidAmount(amount);
  assertValidFeePercentBp(feePercentBp);
  const product = BigInt(amount) * BigInt(feePercentBp);
  const fee = (product + BP_DENOMINATOR / 2n) / BP_DENOMINATOR;
  return Number(fee);
}

/**
 * Returns { fee, amountToReceive } with the exact invariant
 * fee + amountToReceive === amount. amountToReceive is derived by
 * subtraction - never rounded independently, or the invariant can break.
 */
export function splitAmount(
  amount: number,
  feePercentBp: number
): { fee: number; amountToReceive: number } {
  const fee = calculateFee(amount, feePercentBp);
  return { fee, amountToReceive: amount - fee };
}
