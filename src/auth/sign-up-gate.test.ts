import { describe, expect, it } from "bun:test";
import { hasBootstrapSecret, isEmailSignUpRequest } from "./sign-up-gate.ts";

describe("sign-up gate", () => {
    it("detects better-auth email sign-up requests", () => {
        const request = new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST" });

        expect(isEmailSignUpRequest(request)).toBe(true);
        expect(isEmailSignUpRequest(new Request("http://localhost:3001/api/auth/sign-in/email", { method: "POST" }))).toBe(false);
        expect(isEmailSignUpRequest(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "GET" }))).toBe(false);
    });

    it("allows only requests with the configured bootstrap secret", () => {
        const request = new Request("http://localhost:3001/api/auth/sign-up/email", {
            method: "POST",
            headers: { "X-AllCodex-Bootstrap-Secret": "secret-1" },
        });

        expect(hasBootstrapSecret(request, "secret-1")).toBe(true);
        expect(hasBootstrapSecret(request, "secret-2")).toBe(false);
    });

    it("does not allow sign-up when bootstrap secret config is empty", () => {
        const request = new Request("http://localhost:3001/api/auth/sign-up/email", {
            method: "POST",
            headers: { "X-AllCodex-Bootstrap-Secret": "" },
        });

        expect(hasBootstrapSecret(request, "")).toBe(false);
    });
});
