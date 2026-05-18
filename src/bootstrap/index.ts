import { ensureDefaultUser } from "./ensure-default-user.ts";
import { ensureEtapiToken } from "./ensure-etapi-token.ts";
import { rootLogger } from "../logger.ts";

const log = rootLogger.child({ module: "bootstrap" });

export type BootstrapStatus = {
    ran: boolean;
    userReady: boolean;
    etapiReady: boolean;
    error?: string;
};

let _status: BootstrapStatus = {
    ran: false,
    userReady: false,
    etapiReady: false,
};

export function getBootstrapStatus(): BootstrapStatus {
    return { ..._status };
}

async function attempt(): Promise<void> {
    const user = await ensureDefaultUser();
    _status.userReady = true;

    await ensureEtapiToken(user.id);
    _status.etapiReady = true;
}

export async function runBootstrap(): Promise<void> {
    const MAX_ATTEMPTS = 6;
    const DELAY_MS = 5_000;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        try {
            await attempt();
            _status.ran = true;
            _status.error = undefined;
            log.info("Bootstrap complete.");
            return;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.warn(`Bootstrap attempt ${i}/${MAX_ATTEMPTS} failed: ${msg}`);
            _status.error = msg;

            if (_status.userReady && !_status.etapiReady) {
                log.info("User ready but ETAPI failed — Core may not be up yet. Retrying...");
            }

            if (i < MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, DELAY_MS));
            }
        }
    }

    _status.ran = true;
    log.error(`Bootstrap failed after ${MAX_ATTEMPTS} attempts. Check service connectivity and env vars.`);
}
