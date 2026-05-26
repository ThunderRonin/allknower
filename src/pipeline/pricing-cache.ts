export interface ModelPrice {
  pricePerMInput: number;
  pricePerMOutput: number;
}

// May 2026 prices from OpenRouter — fallback when DB/API unavailable
export const STATIC_FALLBACK_PRICING = new Map<string, ModelPrice>([
  ["openai/gpt-4o", { pricePerMInput: 2.5, pricePerMOutput: 10 }],
  ["openai/gpt-4o-mini", { pricePerMInput: 0.15, pricePerMOutput: 0.6 }],
  ["openai/gpt-4.1", { pricePerMInput: 2.0, pricePerMOutput: 8.0 }],
  ["openai/gpt-4.1-mini", { pricePerMInput: 0.4, pricePerMOutput: 1.6 }],
  ["openai/gpt-4.1-nano", { pricePerMInput: 0.1, pricePerMOutput: 0.4 }],
  ["anthropic/claude-sonnet-4-5", { pricePerMInput: 3.0, pricePerMOutput: 15 }],
  ["anthropic/claude-haiku-3.5", { pricePerMInput: 0.8, pricePerMOutput: 4 }],
  ["google/gemini-2.5-pro", { pricePerMInput: 1.25, pricePerMOutput: 10 }],
  ["google/gemini-2.5-flash", { pricePerMInput: 0.15, pricePerMOutput: 0.6 }],
  ["x-ai/grok-3-mini", { pricePerMInput: 0.3, pricePerMOutput: 0.5 }],
  ["x-ai/grok-4.1-fast", { pricePerMInput: 0.6, pricePerMOutput: 2.4 }],
  ["deepseek/deepseek-chat-v3-0324", { pricePerMInput: 0.27, pricePerMOutput: 1.1 }],
  ["deepseek/deepseek-r1", { pricePerMInput: 0.55, pricePerMOutput: 2.19 }],
  ["meta-llama/llama-4-maverick", { pricePerMInput: 0.2, pricePerMOutput: 0.6 }],
  ["meta-llama/llama-4-scout", { pricePerMInput: 0.15, pricePerMOutput: 0.4 }],
]);

const runtimeCache = new Map<string, ModelPrice>();

export function getCachedPricing(modelId: string): ModelPrice | undefined {
  return runtimeCache.get(modelId) ?? STATIC_FALLBACK_PRICING.get(modelId);
}

export function setCachedPricing(modelId: string, price: ModelPrice): void {
  runtimeCache.set(modelId, price);
}

export function loadPricingCache(entries: Map<string, ModelPrice>): void {
  runtimeCache.clear();
  for (const [k, v] of entries) {
    runtimeCache.set(k, v);
  }
}

export function computeCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = getCachedPricing(modelId);
  if (!price) return 0;
  return (inputTokens * price.pricePerMInput + outputTokens * price.pricePerMOutput) / 1_000_000;
}

export function clearRuntimeCache(): void {
  runtimeCache.clear();
}
