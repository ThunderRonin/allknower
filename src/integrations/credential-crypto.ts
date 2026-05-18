import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.ts";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const DEV_FALLBACK_KEY = "dev-only-integration-key-32bytes";

function decodeKey(rawKey = env.INTEGRATION_CREDENTIALS_KEY): Buffer {
    if (!rawKey && env.NODE_ENV !== "production") {
        rawKey = DEV_FALLBACK_KEY;
    }

    if (/^[0-9a-f]{64}$/i.test(rawKey)) return Buffer.from(rawKey, "hex");

    const base64 = Buffer.from(rawKey, "base64");
    if (base64.length === 32) return base64;

    const utf8 = Buffer.from(rawKey, "utf8");
    if (utf8.length === 32) return utf8;

    throw new Error("INTEGRATION_CREDENTIALS_KEY is missing or invalid.");
}

export function encryptCredential(plaintext: string): string {
    const key = decodeKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptCredential(payload: string): string {
    const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(":");
    if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
        throw new Error("Unsupported encrypted credential payload.");
    }

    const decipher = createDecipheriv(ALGORITHM, decodeKey(), Buffer.from(ivRaw, "base64"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedRaw, "base64")),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
}
