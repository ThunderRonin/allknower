import prisma from "../db/client.ts";
import { decryptCredential, encryptCredential } from "./credential-crypto.ts";

const PROVIDER = "allcodex";

export type AllCodexCredentials = {
    baseUrl: string;
    token: string;
};

export class IntegrationNotConnectedError extends Error {
    constructor() {
        super("AllCodex is not connected for this user. Reconnect AllCodex in settings.");
        this.name = "IntegrationNotConnectedError";
    }
}

function normalizeBaseUrl(baseUrl: string): string {
    let url = baseUrl;
    while (url.endsWith("/")) url = url.slice(0, -1);
    return url;
}

export async function connectAllCodexIntegration(
    userId: string,
    credentials: AllCodexCredentials
) {
    const baseUrl = normalizeBaseUrl(credentials.baseUrl);
    const token = credentials.token;

    return prisma.userIntegration.upsert({
        where: { userId_provider: { userId, provider: PROVIDER } },
        create: {
            userId,
            provider: PROVIDER,
            baseUrl,
            encryptedToken: encryptCredential(token),
            tokenLast4: token.slice(-4),
        },
        update: {
            baseUrl,
            encryptedToken: encryptCredential(token),
            tokenLast4: token.slice(-4),
        },
        select: {
            provider: true,
            baseUrl: true,
            tokenLast4: true,
            updatedAt: true,
        },
    });
}

export async function getAllCodexIntegrationStatus(userId: string) {
    const integration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId, provider: PROVIDER } },
        select: {
            baseUrl: true,
            tokenLast4: true,
            updatedAt: true,
        },
    });

    return integration
        ? { connected: true, provider: PROVIDER, ...integration }
        : { connected: false, provider: PROVIDER };
}

export async function deleteAllCodexIntegration(userId: string): Promise<void> {
    await prisma.userIntegration.deleteMany({
        where: { userId, provider: PROVIDER },
    });
}

export async function resolveAllCodexCredentials(userId: string): Promise<AllCodexCredentials> {
    const integration = await prisma.userIntegration.findUnique({
        where: { userId_provider: { userId, provider: PROVIDER } },
        select: { baseUrl: true, encryptedToken: true },
    });

    if (!integration) throw new IntegrationNotConnectedError();

    return {
        baseUrl: integration.baseUrl,
        token: decryptCredential(integration.encryptedToken),
    };
}
