import Elysia from "elysia";
import { auth } from "../auth/index.ts";
import { getOwnerUserId } from "../auth/owner.ts";

async function resolveSession(headers: Headers) {
    try {
        return {
            session: await auth.api.getSession({ headers }),
            authUnavailable: false,
        };
    } catch {
        return {
            session: null,
            authUnavailable: true,
        };
    }
}

/**
 * Scoped middleware that enforces an active better-auth session.
 */
export const requireSessionAuth = new Elysia({ name: "allknower/require-session-auth" })
    .resolve({ as: "scoped" }, async ({ request }) => resolveSession(request.headers))
    .onBeforeHandle({ as: "scoped" }, ({ session, authUnavailable, set }) => {
        if (authUnavailable) {
            set.status = 503;
            return { error: "Auth unavailable" };
        }
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
        const sessionResult = await resolveSession(request.headers);
        if (sessionResult.authUnavailable || !sessionResult.session) {
            return { ...sessionResult, ownerUserId: null };
        }

        try {
            const ownerUserId = await getOwnerUserId();
            return { ...sessionResult, ownerUserId };
        } catch {
            return { ...sessionResult, ownerUserId: null, authUnavailable: true };
        }
    })
    .onBeforeHandle({ as: "scoped" }, ({ session, ownerUserId, authUnavailable, set }) => {
        if (authUnavailable) {
            set.status = 503;
            return { error: "Auth unavailable" };
        }
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
