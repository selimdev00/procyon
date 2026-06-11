import { describe, expect, it } from "vitest";
import { calculateFee, splitAmount, MAX_AMOUNT } from "../../src/lib/money.js";

describe("calculateFee", () => {
  it.each([
    // [amount, feePercentBp, expectedFee]
    [10_000, 250, 250], // 2.5% of 100.00 = 2.50
    [10_000, 0, 0], // zero fee
    [10_000, 10_000, 10_000], // 100% fee
    [1, 1, 0], // 0.0001 rounds down to 0
    [9_999, 250, 250], // 249.975 rounds up
    [1_001, 250, 25], // 25.025 rounds down
    [2, 2_500, 1], // exactly 0.5 -> half-up -> 1
    [6, 2_500, 2], // exactly 1.5 -> half-up -> 2
    [1_000_000_000_000, 9_999, 999_900_000_000], // max amount, no precision loss
  ])("amount=%i bp=%i -> fee=%i", (amount, bp, expected) => {
    expect(calculateFee(amount, bp)).toBe(expected);
  });

  it.each([
    [0, 250],
    [-100, 250],
    [10.5, 250],
    [NaN, 250],
    [MAX_AMOUNT + 1, 250],
    [10_000, -1],
    [10_000, 10_001],
    [10_000, 2.5],
  ])("rejects invalid input amount=%s bp=%s", (amount, bp) => {
    expect(() => calculateFee(amount, bp)).toThrow(RangeError);
  });
});

describe("splitAmount", () => {
  it("holds the invariant fee + amountToReceive === amount across a value sweep", () => {
    const bps = [0, 1, 7, 250, 333, 4_999, 5_000, 9_999, 10_000];
    for (let amount = 1; amount <= 10_000; amount += 97) {
      for (const bp of bps) {
        const { fee, amountToReceive } = splitAmount(amount, bp);
        expect(fee + amountToReceive).toBe(amount);
        expect(Number.isSafeInteger(fee)).toBe(true);
        expect(fee).toBeGreaterThanOrEqual(0);
        expect(amountToReceive).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never rounds amountToReceive independently", () => {
    // 9999 * 2.5% = 249.975: fee rounds to 250, receive must be the exact
    // subtraction 9749 - not an independently rounded 249.975 -> 9749.025 -> 9749.
    expect(splitAmount(9_999, 250)).toEqual({ fee: 250, amountToReceive: 9_749 });
  });
});
