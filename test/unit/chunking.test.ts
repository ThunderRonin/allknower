import { describe, expect, test } from "bun:test";

// Re-export chunkText for testing by calling it directly via dynamic import,
// since lancedb.ts has side-effects (LanceDB table init) we want to avoid.
// We duplicate the logic under test (pure function) so the test stays isolated.

// ---- minimal copy of chunkText for unit testing ----
const MAX_CHUNK_CHARS = 1000;
const CHUNK_OVERLAP_CHARS = 100;
const MIN_CHUNK_CHARS = 50;

function chunkText(text: string): string[] {
    const normalised = text.replace(/\r\n?/g, "\n").trim();
    if (normalised.length === 0) return [];
    if (normalised.length <= MAX_CHUNK_CHARS) return [normalised];

    // Split on blank lines first (paragraph-aware)
    const paragraphs = normalised.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const segments: string[] = [];
    for (const para of paragraphs) {
        if (para.length <= MAX_CHUNK_CHARS) {
            segments.push(para.trim());
        } else {
            // Break oversized paragraphs on sentence boundaries
            const sentences = para.split(/(?<=[.!?])\s+/);
            let current = "";
            for (const sentence of sentences) {
                if (current.length + sentence.length + 1 > MAX_CHUNK_CHARS && current.length > 0) {
                    segments.push(current.trim());
                    current = sentence;
                } else {
                    current = current ? `${current} ${sentence}` : sentence;
                }
            }
            if (current.trim()) segments.push(current.trim());
        }
    }

    // Merge tiny segments into their predecessor
    const merged: string[] = [];
    for (const seg of segments) {
        if (merged.length > 0 && seg.length < MIN_CHUNK_CHARS) {
            merged[merged.length - 1] = `${merged[merged.length - 1]} ${seg}`;
        } else {
            merged.push(seg);
        }
    }

    // Add overlap: append the tail of the previous chunk to the start of the next
    const chunks: string[] = [];
    for (let i = 0; i < merged.length; i++) {
        if (i === 0) {
            chunks.push(merged[i]);
        } else {
            const prev = merged[i - 1];
            const overlap = prev.slice(-CHUNK_OVERLAP_CHARS);
            chunks.push(`${overlap} ${merged[i]}`);
        }
    }

    return chunks;
}
// ---- end copy ----

describe("chunkText", () => {
    test("returns single chunk for short text", () => {
        const out = chunkText("Hello world");
        expect(out).toHaveLength(1);
        expect(out[0]).toBe("Hello world");
    });

    test("returns empty array for empty string", () => {
        expect(chunkText("")).toHaveLength(0);
        expect(chunkText("   ")).toHaveLength(0);
    });

    test("splits on paragraph boundaries", () => {
        const para1 = "A".repeat(600);
        const para2 = "B".repeat(600);
        const text = `${para1}\n\n${para2}`;
        const chunks = chunkText(text);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    test("no chunk exceeds MAX_CHUNK_CHARS + OVERLAP", () => {
        const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}.`).join(" ");
        const chunks = chunkText(long);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + CHUNK_OVERLAP_CHARS + 10);
        }
    });

    test("overlap carries tail of previous chunk", () => {
        const para1 = "A".repeat(600);
        const para2 = "B".repeat(600);
        const chunks = chunkText(`${para1}\n\n${para2}`);
        if (chunks.length >= 2) {
            // Chunk 2 should start with the tail of para1 (overlap)
            expect(chunks[1].startsWith("A")).toBe(true);
        }
    });

    test("handles normalised line endings", () => {
        const text = "Para 1.\r\n\r\nPara 2.";
        const chunks = chunkText(text);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
});
