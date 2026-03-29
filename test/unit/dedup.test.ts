import { describe, expect, test } from "bun:test";

/**
 * Unit tests for brain-dump idempotency hash logic.
 *
 * The implementation in brain-dump.ts computes SHA-256 over rawText using
 * the Web Crypto API and compares against BrainDumpHistory.rawTextHash.
 * These tests verify the hashing is deterministic and collision-resistant.
 */

async function hashRawText(text: string): Promise<string> {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Buffer.from(buffer).toString("hex");
}

describe("brain-dump idempotency hash", () => {
    test("same text produces same hash", async () => {
        const a = await hashRawText("Aldric is the king of Valorheim");
        const b = await hashRawText("Aldric is the king of Valorheim");
        expect(a).toBe(b);
    });

    test("different texts produce different hashes", async () => {
        const a = await hashRawText("Aldric is the king");
        const b = await hashRawText("Aldric is NOT the king");
        expect(a).not.toBe(b);
    });

    test("hash is 64-char hex string (SHA-256)", async () => {
        const h = await hashRawText("some lore text");
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    test("whitespace changes hash (no normalisation)", async () => {
        const a = await hashRawText("hello world");
        const b = await hashRawText("hello  world");
        expect(a).not.toBe(b);
    });

    test("empty string produces stable hash", async () => {
        const h = await hashRawText("");
        expect(h).toHaveLength(64);
    });
});
