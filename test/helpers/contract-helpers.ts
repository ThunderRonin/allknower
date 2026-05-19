import type { ZodSchema } from "zod";

/**
 * Validates `data` against `schema` and returns the parsed value.
 *
 * @param schema - Zod schema to validate against
 * @param data - The value to validate
 * @param label - Label included in the error message when validation fails
 * @returns The parsed `data` as type `T`
 * @throws Error if validation fails; the message lists each issue as `path: message` and includes a truncated `Received:` JSON section
 */
export function assertMatchesSchema<T>(schema: ZodSchema<T>, data: unknown, label: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        const issues = result.error.issues
            .map((i: any) => `  ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Schema mismatch for ${label}:\n${issues}\n\nReceived: ${JSON.stringify(data, null, 2).slice(0, 500)}`);
    }
    return result.data;
}

/**
 * Asserts that an object contains the specified property names.
 *
 * Throws an Error listing any missing fields and the keys that are present when one or more fields are absent.
 *
 * @param obj - The object to check for the required fields
 * @param fields - The property names that must exist on `obj`
 * @param label - A label used in the thrown error message to identify the checked object
 */
export function assertFieldsPresent(obj: Record<string, unknown>, fields: string[], label: string) {
    const missing = fields.filter((f) => !(f in obj));
    if (missing.length > 0) {
        throw new Error(`Missing fields in ${label}: ${missing.join(", ")}\nPresent: ${Object.keys(obj).join(", ")}`);
    }
}

/**
 * Applies a validation function to each element of an array and annotates any validation errors with the element index and provided label.
 *
 * @param arr - The array whose elements will be validated
 * @param check - A function that validates a single item; it should throw on validation failure
 * @param label - A prefix used in the thrown error message to identify the array (the index is appended as `[i]`)
 */
export function assertArrayOf(arr: unknown[], check: (item: unknown) => void, label: string) {
    arr.forEach((item, i) => {
        try {
            check(item);
        } catch (err: any) {
            throw new Error(`${label}[${i}]: ${err.message}`);
        }
    });
}
