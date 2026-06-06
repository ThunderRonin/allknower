import { Elysia, t } from "elysia";
import { auth } from "../auth/index.ts";
import { isOwnerUserId } from "../auth/owner.ts";
import { env } from "../env.ts";
import { requireAuth } from "../plugins/auth-guard.ts";
import {
    connectAllCodexIntegration,
    deleteAllCodexIntegration,
    getAllCodexIntegrationStatus,
    resolveAllCodexCredentials,
} from "../integrations/allcodex.ts";

type SessionContext = {
    session?: { user?: { id?: string } } | null;
};

function getUserId(context: SessionContext): string {
    const userId = context.session?.user?.id;
    if (!userId) throw new Error("Authenticated session is missing a user id.");
    return userId;
}

export const integrationsRoute = new Elysia({ name: "integrations" })
    .use(requireAuth)
    .post(
        "/integrations/allcodex/connect",
        async (context) => {
            const body = context.body;
            const userId = getUserId(context as SessionContext);
            const integration = await connectAllCodexIntegration(userId, {
                baseUrl: body.baseUrl,
                token: body.token,
            });

            return { ok: true, connected: true, integration };
        },
        {
            body: t.Object({
                baseUrl: t.String({ minLength: 1 }),
                token: t.String({ minLength: 1 }),
            }),
            detail: {
                tags: ["System"],
                summary: "Connect authenticated user's AllCodex integration",
            },
        }
    )
    .get(
        "/integrations/allcodex/status",
        async (context) => getAllCodexIntegrationStatus(getUserId(context as SessionContext)),
        {
            detail: {
                tags: ["System"],
                summary: "Get authenticated user's AllCodex integration status",
            },
        }
    )
    .delete(
        "/integrations/allcodex",
        async (context) => {
            await deleteAllCodexIntegration(getUserId(context as SessionContext));
            return { ok: true, connected: false };
        },
        {
            detail: {
                tags: ["System"],
                summary: "Disconnect authenticated user's AllCodex integration",
            },
        }
    );

export const internalIntegrationsRoute = new Elysia({ name: "internal-integrations" })
    .post(
        "/internal/integrations/allcodex/credentials",
        async ({ request, set }) => {
            if (!env.PORTAL_INTERNAL_SECRET) {
                set.status = 503;
                return { error: "PORTAL_INTERNAL_SECRET is not configured." };
            }

            if (request.headers.get("X-Portal-Internal-Secret") !== env.PORTAL_INTERNAL_SECRET) {
                set.status = 403;
                return { error: "Forbidden" };
            }

            const session = await auth.api.getSession({ headers: request.headers });
            const userId = session?.user?.id;
            if (!userId) {
                set.status = 401;
                return { error: "Unauthorized" };
            }
            if (!(await isOwnerUserId(userId))) {
                set.status = 403;
                return { error: "Forbidden" };
            }

            try {
                return await resolveAllCodexCredentials(userId);
            } catch (error) {
                set.status = 404;
                return {
                    error: error instanceof Error ? error.message : String(error),
                    code: "ALLCODEX_NOT_CONNECTED",
                };
            }
        },
        {
            detail: {
                tags: ["System"],
                summary: "Resolve plaintext AllCodex credentials for Portal server",
            },
        }
    );
