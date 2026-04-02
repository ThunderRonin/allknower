import { encoding_for_model } from "tiktoken";

let encoder: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder() {
    if (!encoder) {
        try {
            encoder = encoding_for_model("gpt-4o");
        } catch {
            // tiktoken WASM init can fail in some environments — fall back gracefully
            return null;
        }
    }
    return encoder;
}

/** Count tokens. Uses tiktoken if available, heuristic fallback otherwise. */
export function countTokens(text: string): number {
    const enc = getEncoder();
    if (enc) {
        return enc.encode(text).length;
    }
    // Pessimistic heuristic: /3.5 over-counts → budget loop under-admits (safe)
    return Math.ceil(text.length / 3.5);
}

/**
 * Inverse: approximate character count from token target.
 * Pessimistic (floor * 3.5) so truncation stays within budget.
 */
export function tokensToChars(tokens: number): number {
    return Math.floor(tokens * 3.5);
}
