import { describe, expect, it } from "bun:test";
import { app } from "../../src/app";

describe("E2E API Tests", () => {
    describe("GET /health", () => {
        it("should return 200 OK and health status", async () => {
            const req = new Request("http://localhost/health");
            const res = await app.handle(req);
            
            expect(res.status).toBe(200);
            
            const body = await res.json();
            // Checking structure of health response
            expect(body).toHaveProperty("status");
            expect(body.status).toBe("ok");
            expect(body).toHaveProperty("services");
        });
    });
});
