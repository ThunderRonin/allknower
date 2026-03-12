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

// In Prisma 5+, to use $on("query") safely without 'never', we must 
// declare the exact 'log' options inline without generic widening.
const prisma =
    globalThis.__prisma ??
    new PrismaClient<{ log: [{ emit: "event", level: "query" }, { emit: "event", level: "warn" }, { emit: "event", level: "error" }] }>({
        log: [
            { emit: "event", level: "query" },
            { emit: "event", level: "warn"  },
            { emit: "event", level: "error" },
        ],
    });

if (isDev) {
    prisma.$on("query", (e: any) => {
        const duration = `${e.duration}ms`;
        // Condense the query to one line for readability
        const q = e.query.replace(/\s+/g, " ").trim();
        console.log(`🧠 ${timestamp()} \x1b[36mQUERY\x1b[0m ${duration.padEnd(8)} ${q}`);
    });
}

prisma.$on("warn", (e: any) => {
    console.warn(`🧠 ${timestamp()} \x1b[33mWARN\x1b[0m  ${e.message}`);
});

prisma.$on("error", (e: any) => {
    console.error(`🧠 ${timestamp()} \x1b[31mERROR\x1b[0m ${e.message}`);
});

if (env.NODE_ENV !== "production") {
    globalThis.__prisma = prisma;
}

export default prisma;
