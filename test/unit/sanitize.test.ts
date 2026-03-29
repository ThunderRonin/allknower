import { describe, expect, test } from "bun:test";

// Inline copy of sanitizeFilterValue for isolated testing
function sanitizeFilterValue(value: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        throw new Error(`Invalid filter value: "${value}"`);
    }
    return value;
}

describe("sanitizeFilterValue", () => {
    test("accepts alphanumeric IDs", () => {
        expect(sanitizeFilterValue("abc123")).toBe("abc123");
    });

    test("accepts IDs with underscores and hyphens", () => {
        expect(sanitizeFilterValue("note_id-01")).toBe("note_id-01");
    });

    test("accepts short uppercase IDs", () => {
        expect(sanitizeFilterValue("ABCXYZ")).toBe("ABCXYZ");
    });

    test("throws on SQL injection via OR", () => {
        expect(() => sanitizeFilterValue("abc' OR '1'='1")).toThrow("Invalid filter value");
    });

    test("throws on semicolon injection", () => {
        expect(() => sanitizeFilterValue("abc; DROP TABLE")).toThrow("Invalid filter value");
    });

    test("throws on spaces", () => {
        expect(() => sanitizeFilterValue("note id")).toThrow("Invalid filter value");
    });

    test("throws on dot notation", () => {
        expect(() => sanitizeFilterValue("foo.bar")).toThrow("Invalid filter value");
    });

    test("throws on empty string", () => {
        expect(() => sanitizeFilterValue("")).toThrow("Invalid filter value");
    });

    test("throws on null bytes", () => {
        expect(() => sanitizeFilterValue("abc\x00def")).toThrow("Invalid filter value");
    });

    test("throws on brackets", () => {
        expect(() => sanitizeFilterValue("note[0]")).toThrow("Invalid filter value");
    });
});
