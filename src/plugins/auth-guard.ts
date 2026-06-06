import Elysia from "elysia";
import { auth } from "../auth/index.ts";
import { getOwnerUserId } from "../auth/owner.ts";

/**
 * Scoped middleware that enforces an active better-auth session.
 */
export const requireSessionAuth = new Elysia({ name: "allknower/require-session-auth" })
    .resolve({ as: "scoped" }, async ({ request }) => ({
        session: await auth.api.getSession({ headers: request.headers }),
    }))
    .onBeforeHandle({ as: "scoped" }, ({ session, set }) => {
        if (!session) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
    });

/**
 * Scoped middleware that enforces the single owner/root user.
 * Returns 401 for anonymous, 403 for non-owner authenticated users.
 */
export const requireOwnerAuth = new Elysia({ name: "allknower/require-owner-auth" })
    .resolve({ as: "scoped" }, async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        const ownerUserId = await getOwnerUserId();
        return { session, ownerUserId };
    })
    .onBeforeHandle({ as: "scoped" }, ({ session, ownerUserId, set }) => {
        if (!session) {
            set.status = 401;
            return { error: "Unauthorized" };
        }
        if (!ownerUserId) {
            set.status = 503;
            return { error: "Owner not configured" };
        }
        if (session.user.id !== ownerUserId) {
            set.status = 403;
            return { error: "Forbidden" };
        }
    });

export const requireAuth = requireOwnerAuth;
