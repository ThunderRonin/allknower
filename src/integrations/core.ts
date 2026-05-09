import prisma from "../db/client.ts";
import { probeAllCodex, EtapiCredentials } from "../etapi/client.ts";
import { encrypt, decrypt } from "./crypto.ts";

export const CORE_PROVIDER_NAME = "core";

export async function resolveCoreCredentials(userId: string): Promise<EtapiCredentials> {
    const integration = await prisma.userIntegration.findUnique({
        where: {
            userId_provider: {
                userId,
                provider: CORE_PROVIDER_NAME,
            },
        },
    });

    if (!integration) {
        throw new Error("Core integration not found for user.");
    }

    return {
        baseUrl: integration.baseUrl,
        token: decrypt(integration.encryptedToken),
    };
}

export async function connectCore(userId: string, baseUrl: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const credentials = { baseUrl, token };
    const probe = await probeAllCodex(credentials);
    if (!probe.ok) {
        return probe;
    }

    const tokenLast4 = token.length >= 4 ? token.slice(-4) : token;
    const encryptedToken = encrypt(token);

    await prisma.userIntegration.upsert({
        where: {
            userId_provider: {
                userId,
                provider: CORE_PROVIDER_NAME,
            },
        },
        update: {
            baseUrl,
            encryptedToken,
            tokenLast4,
        },
        create: {
            userId,
            provider: CORE_PROVIDER_NAME,
            baseUrl,
            encryptedToken,
            tokenLast4,
        },
    });

    return { ok: true };
}

export async function getCoreStatus(userId: string): Promise<{ connected: boolean; baseUrl?: string; tokenLast4?: string }> {
    const integration = await prisma.userIntegration.findUnique({
        where: {
            userId_provider: {
                userId,
                provider: CORE_PROVIDER_NAME,
            },
        },
    });

    if (!integration) {
        return { connected: false };
    }

    return {
        connected: true,
        baseUrl: integration.baseUrl,
        tokenLast4: integration.tokenLast4 || undefined,
    };
}

export async function deleteCore(userId: string): Promise<void> {
    try {
        await prisma.userIntegration.delete({
            where: {
                userId_provider: {
                userId,
                provider: CORE_PROVIDER_NAME,
                },
            },
        });
    } catch (err: any) {
        // Ignore "Record to delete does not exist" error
        if (err.code !== "P2025") {
            throw err;
        }
    }
}
