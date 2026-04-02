import Elysia from "elysia";
import { elysiaHelmet } from "elysiajs-helmet";
import { etag } from "@bogeychan/elysia-etag";
import { ip } from "elysia-ip";
import { background } from "elysia-background";


/**
 * Registers all infrastructure plugins on the Elysia app.
 * Route-specific plugins (rate-limit, xss) are applied at the route level.
 */
export const plugins = new Elysia({ name: "allknower/plugins" })
    // Security headers
    // elysiaHelmet bundles elysia 1.4.25; project uses 1.4.28 — cast suppresses the private-field structural mismatch
    .use(
        elysiaHelmet({
            // CSP must allow Scalar UI (CDN scripts/styles) — override defaults
            csp: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https:", "data:"],
                imgSrc: ["'self'", "data:", "blob:", "https://cdn.jsdelivr.net"],
                connectSrc: ["'self'"],
                frameSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
            },
        }) as any
    )
    // Automatic ETag caching headers on GET responses
    .use(etag())
    // Background task queue — makes backgroundTasks available in all route handlers
    .use(background())
    // IP resolution — available in request context for logging and auth
    .use(ip());
