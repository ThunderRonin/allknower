import prisma from "../db/client.ts";

export const OWNER_USER_ID_KEY = "ownerUserId";

export async function getOwnerUserId(): Promise<string | null> {
    const row = await prisma.appConfig.findUnique({
        where: { key: OWNER_USER_ID_KEY },
        select: { value: true },
    });
    return row?.value ?? null;
}

export async function ensureOwnerUserId(userId: string): Promise<string> {
    const existing = await getOwnerUserId();
    if (existing) return existing;

    try {
        await prisma.appConfig.create({
            data: { key: OWNER_USER_ID_KEY, value: userId },
        });
        return userId;
    } catch (error) {
        const ownerUserId = await getOwnerUserId();
        if (ownerUserId) return ownerUserId;
        throw error;
    }
}

export async function isOwnerUserId(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const ownerUserId = await getOwnerUserId();
    return ownerUserId === userId;
}
