import { Elysia } from "elysia";
import { randomBytes } from "crypto";
import prisma from "../db/client.ts";
import { env } from "../env.ts";
import { getBootstrapStatus } from "../bootstrap/index.ts";
import { rootLogger } from "../logger.ts";

const log = rootLogger.child({ module: "auto-provision" });

export const autoProvisionRoute = new Elysia({ name: "auto-provision" }).post(
    "/internal/auto-provision",
    async ({ request, set }) => {
        if (!env.PORTAL_INTERNAL_SECRET) {
            set.status = 503;
            return { error: "PORTAL_INTERNAL_SECRET is not configured." };
        }

        if (request.headers.get("X-Portal-Internal-Secret") !== env.PORTAL_INTERNAL_SECRET) {
            set.status = 403;
            return { error: "Forbidden" };
        }

        const status = getBootstrapStatus();
        if (!status.userReady) {
            set.status = 503;
            return { error: "Bootstrap not complete — no default user.", bootstrapStatus: status };
        }

        const defaultUser = await prisma.user.findFirst({
            select: { id: true, email: true, name: true },
        });

        if (!defaultUser) {
            set.status = 503;
            return { error: "No users in database." };
        }

        const existingSession = await prisma.session.findFirst({
            where: {
                userId: defaultUser.id,
                expiresAt: { gt: new Date() },
                userAgent: "auto-provision",
            },
            select: { token: true, expiresAt: true },
        });

        if (existingSession) {
            log.info(`Reusing existing auto-provision session for ${defaultUser.email}`);
            return {
                token: existingSession.token,
                url: env.BETTER_AUTH_URL,
                userId: defaultUser.id,
                expiresAt: existingSession.expiresAt.toISOString(),
            };
        }

        const token = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await prisma.session.create({
            data: {
                userId: defaultUser.id,
                token,
                expiresAt,
                ipAddress: "internal",
                userAgent: "auto-provision",
            },
        });

        log.info(`Auto-provisioned session for ${defaultUser.email}`);

        return {
            token,
            url: env.BETTER_AUTH_URL,
            userId: defaultUser.id,
            expiresAt: expiresAt.toISOString(),
        };
    },
    {
        detail: {
            tags: ["System"],
            summary: "Auto-provision a session for the default user (Portal middleware)",
        },
    }
);
