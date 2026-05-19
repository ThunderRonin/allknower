// test/helpers/e2e-harness.ts
import { rm } from "node:fs/promises";
import { E2E_LANCEDB_DIR } from "./e2e-mock-setup.ts";
export { LLM_RESPONSES } from "./mock-llm.ts";
export { E2E_LANCEDB_DIR };

export async function cleanupLanceDb(): Promise<void> {
    await rm(E2E_LANCEDB_DIR, { recursive: true, force: true }).catch(() => {});
}
