import Elysia from "elysia";
import prisma from "../db/client.ts";
import { requireAuth } from "../plugins/auth-guard.ts";

type MetricsRouteDeps = {
    requireAuthImpl?: typeof requireAuth;
};

export function createMetricsRoute({ requireAuthImpl = requireAuth }: MetricsRouteDeps = {}) {
    return new Elysia({ prefix: "/metrics" })
        .use(requireAuthImpl)
        .get("/llm", async ({ session }) => {
        // @deprecated — use /usage/summary instead
        const userId = session!.user.id;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch logs for the user from last 30 days
        const logs = await prisma.lLMCallLog.findMany({
            where: {
                userId,
                createdAt: {
                    gte: thirtyDaysAgo,
                },
            },
            orderBy: {
                createdAt: "asc",
            },
        });

        // Group by day for daily burn
        const dailyBurnMap = new Map<string, { date: string; tokens: number; count: number }>();
        // Initialize last 30 days
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];
            dailyBurnMap.set(dateStr, { date: dateStr, tokens: 0, count: 0 });
        }

        const taskCosts: Record<string, { tokens: number; count: number; totalLatencyMs: number }> = {};
        const modelDist: Record<string, { tokens: number; count: number }> = {};
        const latenciesByTaskModel: Record<string, number[]> = {};

        for (const log of logs) {
            const dateStr = log.createdAt.toISOString().split("T")[0];
            const burn = dailyBurnMap.get(dateStr) || { date: dateStr, tokens: 0, count: 0 };
            burn.tokens += log.tokensUsed;
            burn.count += 1;
            dailyBurnMap.set(dateStr, burn);

            // Group by task type
            if (!taskCosts[log.task]) {
                taskCosts[log.task] = { tokens: 0, count: 0, totalLatencyMs: 0 };
            }
            taskCosts[log.task].tokens += log.tokensUsed;
            taskCosts[log.task].count += 1;
            taskCosts[log.task].totalLatencyMs += log.latencyMs;

            // Group by model
            if (!modelDist[log.model]) {
                modelDist[log.model] = { tokens: 0, count: 0 };
            }
            modelDist[log.model].tokens += log.tokensUsed;
            modelDist[log.model].count += 1;

            // Collect latencies for percentiles
            const key = `${log.task}::${log.model}`;
            if (!latenciesByTaskModel[key]) {
                latenciesByTaskModel[key] = [];
            }
            latenciesByTaskModel[key].push(log.latencyMs);
        }

        // Calculate latency percentiles helper
        const getPercentile = (arr: number[], p: number): number => {
            if (arr.length === 0) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = Math.floor((sorted.length - 1) * p);
            return sorted[idx];
        };

        const latencyStats = Object.entries(latenciesByTaskModel).map(([key, arr]) => {
            const [task, model] = key.split("::");
            const sum = arr.reduce((a, b) => a + b, 0);
            const avg = Math.round(sum / arr.length);
            const p50 = getPercentile(arr, 0.5);
            const p90 = getPercentile(arr, 0.9);
            const p95 = getPercentile(arr, 0.95);
            return {
                task,
                model,
                count: arr.length,
                avg,
                p50,
                p90,
                p95,
            };
        });

        // Summary stats
        const totalTokens = logs.reduce((sum, l) => sum + l.tokensUsed, 0);
        const totalRequests = logs.length;
        const avgLatency = totalRequests > 0 ? Math.round(logs.reduce((sum, l) => sum + l.latencyMs, 0) / totalRequests) : 0;

        return {
            summary: {
                totalTokens,
                totalRequests,
                avgLatency,
            },
            dailyBurn: Array.from(dailyBurnMap.values()),
            taskCosts: Object.entries(taskCosts).map(([task, data]) => ({
                task,
                tokens: data.tokens,
                count: data.count,
                avgLatency: data.count > 0 ? Math.round(data.totalLatencyMs / data.count) : 0,
            })),
            modelDistribution: Object.entries(modelDist).map(([model, data]) => ({
                model,
                tokens: data.tokens,
                count: data.count,
            })),
            latencyStats,
        };
    });
}

export const metricsRoute = createMetricsRoute();
