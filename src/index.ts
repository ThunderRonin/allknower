import { app } from "./app.ts";
import { env } from "./env.ts";
import { runBootstrap } from "./bootstrap/index.ts";
import { startBrainDumpWorker } from "./worker/brain-dump-worker.ts";
import { fetchAndCachePricing } from "./pipeline/pricing-fetcher.ts";
import { dispatchDailyDigests } from "./pipeline/budget-alerts.ts";

const PORT = env.PORT;

await app.listen(PORT);

const origin = `http://${app.server!.hostname}:${app.server!.port}`;

console.log(
    `\n🧠 AllKnower is running at ${origin}\n` +
    `   📖 API docs: ${origin}/reference\n` +
    `   ❤️  Health:   ${origin}/health\n`
);

runBootstrap().catch((e) => {
    console.error("❌ Bootstrap failed unexpectedly:", e);
});

if (env.NODE_ENV !== "test") {
    void (async () => {
        try {
            await startBrainDumpWorker();
        } catch (e) {
            console.error("❌ Brain dump worker failed to start:", e);
        }
    })();

    const NIGHTLY_INTERVAL_MS = 24 * 60 * 60 * 1_000;
    setTimeout(() => {
        const runNightly = async () => {
            try {
                await fetchAndCachePricing();
                await dispatchDailyDigests();
            } catch (e) {
                console.error("❌ Nightly scheduler error:", e);
            }
        };
        runNightly();
        setInterval(runNightly, NIGHTLY_INTERVAL_MS);
    }, 60_000);
}
