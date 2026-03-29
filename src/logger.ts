/**
 * Structured JSON logger for AllKnower.
 *
 * Outputs newline-delimited JSON to stdout/stderr so log aggregators
 * (Loki, Datadog, CloudWatch, etc.) can parse fields directly.
 *
 * Usage:
 *   import { rootLogger } from "./logger.ts";
 *   const log = rootLogger.child({ requestId, task: "brain-dump" });
 *   log.info("Processing entity", { noteId, title });
 *
 * Pipeline functions that don't have request context accept an optional
 * `log` parameter defaulting to rootLogger:
 *   export async function indexNote(noteId: string, log = rootLogger) { ... }
 */

export interface LogContext {
    requestId?: string;
    task?: string;
    [key: string]: unknown;
}

class Logger {
    private context: LogContext;

    constructor(context: LogContext = {}) {
        this.context = context;
    }

    /** Create a child logger with additional context fields merged in. */
    child(ctx: LogContext): Logger {
        return new Logger({ ...this.context, ...ctx });
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.emit("info", message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.emit("warn", message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.emit("error", message, data);
    }

    private emit(level: string, message: string, data?: Record<string, unknown>): void {
        const entry = {
            level,
            timestamp: new Date().toISOString(),
            ...this.context,
            message,
            ...data,
        };
        const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
        fn(JSON.stringify(entry));
    }
}

export const rootLogger = new Logger();
export type { Logger };
