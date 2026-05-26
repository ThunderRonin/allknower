import prisma from "../db/client.ts";
import { setCachedPricing, STATIC_FALLBACK_PRICING, type ModelPrice } from "./pricing-cache.ts";

interface OpenRouterModel {
  id: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export function buildPricingMap(
  models: OpenRouterModel[],
): Map<string, ModelPrice> {
  const map = new Map<string, ModelPrice>();
  for (const m of models) {
    const promptStr = m.pricing?.prompt;
    const completionStr = m.pricing?.completion;
    if (!promptStr || !completionStr) continue;

    const perTokenInput = Number.parseFloat(promptStr);
    const perTokenOutput = Number.parseFloat(completionStr);
    if (!Number.isFinite(perTokenInput) || !Number.isFinite(perTokenOutput)) continue;
    if (perTokenInput === 0 && perTokenOutput === 0) continue;

    map.set(m.id, {
      pricePerMInput: perTokenInput * 1_000_000,
      pricePerMOutput: perTokenOutput * 1_000_000,
    });
  }
  return map;
}

export async function fetchAndCachePricing(): Promise<void> {
  let models: OpenRouterModel[];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[pricing-fetcher] OpenRouter returned ${res.status}, using cached/static pricing`);
      return;
    }
    const body = await res.json();
    models = body.data ?? [];
  } catch (e) {
    console.warn("[pricing-fetcher] Failed to fetch OpenRouter models:", e);
    return;
  }

  const freshPricing = buildPricingMap(models);

  const upserts = Array.from(freshPricing.entries()).map(([modelId, price]) =>
    prisma.modelPricing.upsert({
      where: { modelId },
      create: {
        modelId,
        pricePerMInput: price.pricePerMInput,
        pricePerMOutput: price.pricePerMOutput,
      },
      update: {
        pricePerMInput: price.pricePerMInput,
        pricePerMOutput: price.pricePerMOutput,
        lastFetched: new Date(),
      },
    }),
  );

  const BATCH_SIZE = 50;
  for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
    await Promise.all(upserts.slice(i, i + BATCH_SIZE));
  }

  for (const [modelId, price] of STATIC_FALLBACK_PRICING) {
    if (!freshPricing.has(modelId)) {
      freshPricing.set(modelId, price);
    }
  }

  for (const [modelId, price] of freshPricing) {
    setCachedPricing(modelId, price);
  }

  console.log(`[pricing-fetcher] Cached ${freshPricing.size} model prices`);
}

export async function initPricingCacheFromDb(): Promise<void> {
  try {
    const rows = await prisma.modelPricing.findMany();
    for (const row of rows) {
      setCachedPricing(row.modelId, {
        pricePerMInput: Number.parseFloat(row.pricePerMInput.toString()),
        pricePerMOutput: Number.parseFloat(row.pricePerMOutput.toString()),
      });
    }
    console.log(`[pricing-fetcher] Loaded ${rows.length} prices from DB`);
  } catch (e) {
    console.warn("[pricing-fetcher] Failed to load pricing from DB, using static fallback:", e);
  }
}
