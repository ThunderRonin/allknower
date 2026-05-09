import crypto from "crypto";
import { env } from "../env.ts";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
    let raw = env.INTEGRATION_CREDENTIALS_KEY;
    if (!raw) {
        if (env.NODE_ENV !== "production") {
            // Fallback for dev if not set
            raw = "0000000000000000000000000000000000000000000000000000000000000000";
        } else {
            throw new Error("INTEGRATION_CREDENTIALS_KEY is required in production");
        }
    }
    
    if (/^[0-9a-f]{64}$/i.test(raw)) {
        return Buffer.from(raw, "hex");
    }
    
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32 && b64.toString("base64") === raw) {
        return b64;
    }
    
    const utf8 = Buffer.from(raw, "utf8");
    if (utf8.length === 32) {
        return utf8;
    }
    
    throw new Error("Invalid INTEGRATION_CREDENTIALS_KEY format. Must be 32 bytes.");
}

export function encrypt(text: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, iv, key);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
    const key = getKey();
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted text format");
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, iv, key);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
