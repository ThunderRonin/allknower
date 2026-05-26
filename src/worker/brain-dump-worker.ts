import prisma from "../db/client.ts";
import { rootLogger } from "../logger.ts";
import { runBrainDump } from "../pipeline/brain-dump.ts";
import { resolveAllCodexCredentials } from "../integrations/allcodex.ts";

const log = rootLogger.child({ module: "brain-dump-worker" });
const POLL_INTERVAL_MS = 2_000;
let running = false;

export async function recoverStaleJobs(): Promise<number> {
    const result = await prisma.brainDumpJob.updateMany({
        where: { status: "running" },
        data: { status: "queued", startedAt: null },
    });
    if (result.count > 0) log.warn("Recovered stale jobs", { count: result.count });
    return result.count;
}

async function processNextJob(): Promise<boolean> {
    const claimed = await prisma.$transaction(async (tx) => {
        const next = await tx.brainDumpJob.findFirst({
            where: { status: "queued" },
            orderBy: { createdAt: "asc" },
        });
        if (!next) return null;
        await tx.brainDumpJob.update({
            where: { id: next.id },
            data: { status: "running", startedAt: new Date() },
        });
        return next;
    });

    if (!claimed) return false;

    try {
        const credentials = await resolveAllCodexCredentials(claimed.userId);
        const result = await runBrainDump(claimed.rawText, claimed.mode as "auto" | "review", {
            credentials,
            userId: claimed.userId,
        });
        const historyId = "historyId" in result ? (result as any).historyId ?? null : null;
        await prisma.brainDumpJob.update({
            where: { id: claimed.id },
            data: {
                status: "done",
                resultHistoryId: historyId,
                finishedAt: new Date(),
            },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.brainDumpJob.update({
            where: { id: claimed.id },
            data: {
                status: "failed",
                error: msg.slice(0, 500),
                finishedAt: new Date(),
            },
        });
        log.warn("Job failed", { jobId: claimed.id, error: msg });
    }
    return true;
}

export async function startBrainDumpWorker(): Promise<void> {
    if (running) return;
    running = true;
    await recoverStaleJobs();
    log.info("Brain dump worker started");

    const loop = async () => {
        while (running) {
            try {
                const processed = await processNextJob();
                if (!processed) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            } catch (e) {
                log.error("Worker loop error", { error: String(e) });
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            }
        }
    };
    loop();
}

export function stopBrainDumpWorker(): void {
    running = false;
}
