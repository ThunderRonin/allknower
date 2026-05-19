import type { ZodSchema } from "zod";

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

export function assertFieldsPresent(obj: Record<string, unknown>, fields: string[], label: string) {
    const missing = fields.filter((f) => !(f in obj));
    if (missing.length > 0) {
        throw new Error(`Missing fields in ${label}: ${missing.join(", ")}\nPresent: ${Object.keys(obj).join(", ")}`);
    }
}

export function assertArrayOf(arr: unknown[], check: (item: unknown) => void, label: string) {
    arr.forEach((item, i) => {
        try {
            check(item);
        } catch (err: any) {
            throw new Error(`${label}[${i}]: ${err.message}`);
        }
    });
}
