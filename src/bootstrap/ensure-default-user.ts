import prisma from "../db/client.ts";
import { env } from "../env.ts";
import { rootLogger } from "../logger.ts";
import { ensureOwnerUserId } from "../auth/owner.ts";

const log = rootLogger.child({ module: "bootstrap" });

const DEFAULT_EMAIL = "default@allcodex.local";
const DEFAULT_NAME = "Default User";

export interface DefaultUser {
    id: string;
    email: string;
    name: string | null;
    isNew: boolean;
}

export async function ensureDefaultUser(): Promise<DefaultUser> {
    const existing = await prisma.user.findFirst({
        select: { id: true, email: true, name: true },
    });

    if (existing) {
        log.info(`Default user resolved: ${existing.email} (${existing.id})`);
        await ensureOwnerUserId(existing.id);
        return { ...existing, isNew: false };
    }

    log.info("No users found. Creating default user...");

    const password = env.ALLCODEX_PASSWORD || "allcodex-default-password";

    const res = await fetch(`${env.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: env.BETTER_AUTH_URL,
            "X-AllCodex-Bootstrap-Secret": env.PORTAL_INTERNAL_SECRET,
        },
        body: JSON.stringify({
            email: DEFAULT_EMAIL,
            password,
            name: DEFAULT_NAME,
        }),
        signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to create default user: ${res.status} ${body}`);
    }

    const user = await prisma.user.findFirst({
        where: { email: DEFAULT_EMAIL },
        select: { id: true, email: true, name: true },
    });

    if (!user) {
        throw new Error("Default user was created but not found in database");
    }

    log.info(`Default user created: ${user.email} (${user.id})`);
    await ensureOwnerUserId(user.id);
    return { ...user, isNew: true };
}
