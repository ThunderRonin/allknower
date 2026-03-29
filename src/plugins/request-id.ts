import Elysia from "elysia";
import { rootLogger } from "../logger.ts";

/**
 * Request ID plugin — generates a unique 8-char ID per request and
 * stores a child logger in the Elysia context.
 *
 * Accessible in route handlers as `{ requestId, log }`.
 */
export const requestIdPlugin = new Elysia({ name: "allknower/request-id" })
    .derive({ as: "global" }, () => {
        const requestId = crypto.randomUUID().slice(0, 8);
        return { requestId, log: rootLogger.child({ requestId }) };
    });
