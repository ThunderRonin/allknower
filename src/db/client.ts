import { PrismaClient } from "@prisma/client";
import { env } from "../env.ts";

declare global {
    // Prevent multiple Prisma client instances in development (hot reload)
    // eslint-disable-next-line no-var
    var __prisma: PrismaClient<{ log: [{ emit: "event", level: "query" }, { emit: "event", level: "warn" }, { emit: "event", level: "error" }] }> | undefined;
}

function timestamp() {
    return new Date().toTimeString().slice(0, 8);
}

type LogLevel = "query" | "error" | "warn" | "info";
type PrismEventLog = { emit: "event", level: LogLevel };

const isDev = env.NODE_ENV !== "production";

const createPrisma = (urlOverride?: string) => {
    return new PrismaClient<{ log: [{ emit: "event", level: "query" }, { emit: "event", level: "warn" }, { emit: "event", level: "error" }] }>({
        ...(urlOverride ? { datasources: { db: { url: urlOverride } } } : {}),
        log: [
            { emit: "event", level: "query" },
            { emit: "event", level: "warn"  },
            { emit: "event", level: "error" },
        ],
    } as any);
};

let prisma = globalThis.__prisma;

if (!prisma) {
    const defaultUrl = env.DATABASE_URL;
    if (!defaultUrl) {
        throw new Error("DATABASE_URL is not set. AllKnower cannot connect to PostgreSQL.");
    }
    const fallbackPorts = ["5433", "5432", "5434", "5435"];

    // We try the default URL first. Then we parse out the port and try the fallbacks.
    const urlsToTry = [defaultUrl];
    
    for (const port of fallbackPorts) {
        const fallbackUrl = defaultUrl.replace(/:(\d+)\//, `:${port}/`);
        if (!urlsToTry.includes(fallbackUrl)) {
            urlsToTry.push(fallbackUrl);
        }
    }

    for (const url of urlsToTry) {
        prisma = createPrisma(url);
        try {
            await prisma.$connect();
            // Just a small visual confirmation in dev mode
            if (isDev) {
                const portMatch = url.match(/:(\d+)\//);
                console.log(`🧠 \x1b[32mDatabase connected\x1b[0m on port ${portMatch ? portMatch[1] : "unknown"}`);
            }
            break;
        } catch (e: any) {
            const portMatch = url.match(/:(\d+)\//);
            console.warn(`🧠 \x1b[33mWARN\x1b[0m Database connection failed on port ${portMatch ? portMatch[1] : "unknown"}. Trying fallback...`);
            await prisma.$disconnect().catch(() => {});
            prisma = undefined;
        }
    }

    if (!prisma) {
        throw new Error(
            `Failed to connect to PostgreSQL on any port. AllKnower cannot start.`
        );
    }
}

if (isDev && prisma) {
    prisma.$on("query", (e: any) => {
        const duration = `${e.duration}ms`;
        const q = e.query.replace(/\s+/g, " ").trim();
        console.log(`🧠 ${timestamp()} \x1b[36mQUERY\x1b[0m ${duration.padEnd(8)} ${q}`);
    });
}

if (prisma) {
    prisma.$on("warn", (e: any) => {
        console.warn(`🧠 ${timestamp()} \x1b[33mWARN\x1b[0m  ${e.message}`);
    });

    prisma.$on("error", (e: any) => {
        console.error(`🧠 ${timestamp()} \x1b[31mERROR\x1b[0m ${e.message}`);
    });
}

if (env.NODE_ENV !== "production") {
    globalThis.__prisma = prisma;
}

export default prisma!;
