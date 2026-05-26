import { describe, it, expect, beforeEach } from "bun:test";
import {
  getCachedPricing,
  setCachedPricing,
  loadPricingCache,
  computeCostUsd,
  clearRuntimeCache,
  STATIC_FALLBACK_PRICING,
  type ModelPrice,
} from "./pricing-cache.ts";

describe("pricing-cache", () => {
  beforeEach(() => {
    clearRuntimeCache();
  });

  it("returns undefined for unknown model", () => {
    expect(getCachedPricing("unknown/model-xyz")).toBeUndefined();
  });

  it("falls back to STATIC_FALLBACK_PRICING", () => {
    const price = getCachedPricing("openai/gpt-4o");
    expect(price).toBeDefined();
    expect(price!.pricePerMInput).toBe(2.5);
    expect(price!.pricePerMOutput).toBe(10);
  });

  it("setCachedPricing overrides static fallback", () => {
    setCachedPricing("openai/gpt-4o", { pricePerMInput: 99, pricePerMOutput: 99 });
    const price = getCachedPricing("openai/gpt-4o");
    expect(price!.pricePerMInput).toBe(99);
  });

  it("loadPricingCache replaces runtime cache", () => {
    setCachedPricing("a", { pricePerMInput: 1, pricePerMOutput: 1 });
    loadPricingCache(new Map([["b", { pricePerMInput: 2, pricePerMOutput: 2 }]]));
    expect(getCachedPricing("a")).toBeUndefined(); // runtime cleared, "a" not in static
    expect(getCachedPricing("b")!.pricePerMInput).toBe(2);
  });

  it("computeCostUsd calculates correctly", () => {
    setCachedPricing("test/model", { pricePerMInput: 2.0, pricePerMOutput: 8.0 });
    const cost = computeCostUsd("test/model", 1000, 500);
    // (1000 * 2 + 500 * 8) / 1_000_000 = 6000 / 1_000_000 = 0.006
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it("computeCostUsd returns 0 for unknown model", () => {
    expect(computeCostUsd("unknown/xyz", 1000, 500)).toBe(0);
  });

  it("STATIC_FALLBACK_PRICING has at least 10 entries", () => {
    expect(STATIC_FALLBACK_PRICING.size).toBeGreaterThanOrEqual(10);
  });
});
