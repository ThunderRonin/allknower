import prisma from "../db/client.ts";
import { env } from "../env.ts";
import { invalidateCredentialCache } from "../etapi/client.ts";
import { connectAllCodexIntegration } from "../integrations/allcodex.ts";
import { rootLogger } from "../logger.ts";

const log = rootLogger.child({ module: "bootstrap" });

export async function ensureEtapiToken(defaultUserId: string): Promise<void> {
    const existingToken = await prisma.appConfig.findUnique({
        where: { key: "allcodexToken" },
    });

    if (existingToken?.value) {
        log.info("ETAPI token already configured in AppConfig.");
        await ensureUserIntegration(defaultUserId, env.ALLCODEX_URL, existingToken.value);
        return;
    }

    if (!env.ALLCODEX_PASSWORD) {
        if (env.ALLCODEX_ETAPI_TOKEN) {
            log.info("Using ALLCODEX_ETAPI_TOKEN from env (no password for bootstrap).");
            await persistToken(defaultUserId, env.ALLCODEX_URL, env.ALLCODEX_ETAPI_TOKEN);
            return;
        }
        log.warn("No ALLCODEX_PASSWORD or ALLCODEX_ETAPI_TOKEN — cannot bootstrap ETAPI token. Manual configuration required.");
        return;
    }

    log.info("Requesting ETAPI token from Core...");

    const res = await fetch(`${env.ALLCODEX_URL}/etapi/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            password: env.ALLCODEX_PASSWORD,
            tokenName: "AllKnower (auto-provisioned)",
        }),
        signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`ETAPI login failed: ${res.status} ${body}`);
    }

    const { authToken } = (await res.json()) as { authToken: string };
    if (!authToken || typeof authToken !== "string") {
        throw new Error("Core returned invalid ETAPI token response");
    }
    log.info("ETAPI token obtained from Core.");

    await persistToken(defaultUserId, env.ALLCODEX_URL, authToken);
}

async function persistToken(userId: string, url: string, token: string): Promise<void> {
    await Promise.all([
        prisma.appConfig.upsert({
            where: { key: "allcodexUrl" },
            update: { value: url },
            create: { key: "allcodexUrl", value: url },
        }),
        prisma.appConfig.upsert({
            where: { key: "allcodexToken" },
            update: { value: token },
            create: { key: "allcodexToken", value: token },
        }),
    ]);

    invalidateCredentialCache();

    await ensureUserIntegration(userId, url, token);

    log.info("ETAPI credentials persisted to AppConfig + UserIntegration.");
}

async function ensureUserIntegration(userId: string, baseUrl: string, token: string): Promise<void> {
    const existing = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId, provider: "allcodex" } },
    });

    if (existing) return;

    await connectAllCodexIntegration(userId, { baseUrl, token });
}
