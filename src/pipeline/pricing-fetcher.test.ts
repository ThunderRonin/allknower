import { describe, it, expect } from "bun:test";
import { buildPricingMap } from "./pricing-fetcher.ts";

// We only unit test buildPricingMap here — fetchAndCachePricing and initPricingCacheFromDb
// need DB/network and are covered by integration tests

describe("buildPricingMap", () => {
  it("converts OpenRouter pricing strings to per-million numbers", () => {
    const models = [
      {
        id: "test/model-a",
        pricing: { prompt: "0.0000025", completion: "0.00001" },
      },
    ];
    const map = buildPricingMap(models);
    expect(map.size).toBe(1);
    const price = map.get("test/model-a")!;
    expect(price.pricePerMInput).toBeCloseTo(2.5, 4);
    expect(price.pricePerMOutput).toBeCloseTo(10, 4);
  });

  it("skips models with null pricing", () => {
    const models = [
      { id: "test/no-pricing" },
      { id: "test/partial", pricing: { prompt: "0.001" } },
    ];
    const map = buildPricingMap(models);
    expect(map.size).toBe(0);
  });

  it("skips free models (0/0 pricing)", () => {
    const models = [
      { id: "test/free", pricing: { prompt: "0", completion: "0" } },
    ];
    const map = buildPricingMap(models);
    expect(map.size).toBe(0);
  });

  it("handles large model list", () => {
    const models = Array.from({ length: 200 }, (_, i) => ({
      id: `test/model-${i}`,
      pricing: { prompt: "0.000001", completion: "0.000002" },
    }));
    const map = buildPricingMap(models);
    expect(map.size).toBe(200);
  });

  it("skips non-finite pricing values", () => {
    const models = [
      { id: "test/nan", pricing: { prompt: "not-a-number", completion: "0.001" } },
    ];
    const map = buildPricingMap(models);
    expect(map.size).toBe(0);
  });
});
