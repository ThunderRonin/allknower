import Elysia, { t } from "elysia";
import { requireAuth } from "../plugins/auth-guard.ts";
import prisma from "../db/client.ts";
import { getAlertStatus } from "../pipeline/budget-alerts.ts";
import { fetchAndCachePricing } from "../pipeline/pricing-fetcher.ts";
import type { Prisma } from "@prisma/client";

type UsageRouteDeps = {
  requireAuthImpl?: typeof requireAuth;
  getAlertStatusImpl?: typeof getAlertStatus;
  fetchAndCachePricingImpl?: typeof fetchAndCachePricing;
};

export function createUsageRoute({
  requireAuthImpl = requireAuth,
  getAlertStatusImpl = getAlertStatus,
  fetchAndCachePricingImpl = fetchAndCachePricing,
}: UsageRouteDeps = {}) {
  return new Elysia({ prefix: "/usage" })
    .use(requireAuthImpl)

    .get(
      "/summary",
      async ({ query, session }) => {
        const userId = session!.user.id;
        const now = new Date();
        const from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86_400_000);
        const to = query.to ? new Date(query.to) : now;

        const where: Prisma.LLMCallLogWhereInput = {
          userId,
          createdAt: { gte: from, lte: to },
        };

        const [logs, totalAgg] = await Promise.all([
          prisma.lLMCallLog.findMany({
            where,
            select: {
              task: true,
              model: true,
              tokensUsed: true,
              inputTokens: true,
              outputTokens: true,
              costUsd: true,
              latencyMs: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          }),
          prisma.lLMCallLog.aggregate({
            where,
            _sum: { tokensUsed: true, costUsd: true },
            _avg: { latencyMs: true },
            _count: true,
          }),
        ]);

        const totalTokens = totalAgg._sum.tokensUsed ?? 0;
        const totalCostUsd = Number.parseFloat((totalAgg._sum.costUsd ?? 0).toString());
        const avgLatency = Math.round(totalAgg._avg.latencyMs ?? 0);
        const totalRequests = totalAgg._count;

        // Daily burn — zero-fill all days in range
        const dailyMap = new Map<string, { tokens: number; cost: number; count: number }>();
        const cursor = new Date(from);
        while (cursor <= to) {
          dailyMap.set(cursor.toISOString().slice(0, 10), { tokens: 0, cost: 0, count: 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
        for (const log of logs) {
          const day = log.createdAt.toISOString().slice(0, 10);
          const entry = dailyMap.get(day);
          if (entry) {
            entry.tokens += log.tokensUsed;
            entry.cost += log.costUsd ? Number.parseFloat(log.costUsd.toString()) : 0;
            entry.count++;
          }
        }
        const dailyBurn = Array.from(dailyMap.entries()).map(([date, v]) => ({
          date,
          tokens: v.tokens,
          cost: v.cost,
          count: v.count,
        }));

        // Task costs
        const taskMap = new Map<string, { tokens: number; cost: number; count: number; latencySum: number }>();
        for (const log of logs) {
          const t = taskMap.get(log.task) ?? { tokens: 0, cost: 0, count: 0, latencySum: 0 };
          t.tokens += log.tokensUsed;
          t.cost += log.costUsd ? Number.parseFloat(log.costUsd.toString()) : 0;
          t.count++;
          t.latencySum += log.latencyMs;
          taskMap.set(log.task, t);
        }
        const taskCosts = Array.from(taskMap.entries()).map(([task, v]) => ({
          task,
          tokens: v.tokens,
          cost: v.cost,
          count: v.count,
          avgLatency: Math.round(v.latencySum / v.count),
        }));

        // Model distribution
        const modelMap = new Map<string, { tokens: number; cost: number; count: number }>();
        for (const log of logs) {
          const m = modelMap.get(log.model) ?? { tokens: 0, cost: 0, count: 0 };
          m.tokens += log.tokensUsed;
          m.cost += log.costUsd ? Number.parseFloat(log.costUsd.toString()) : 0;
          m.count++;
          modelMap.set(log.model, m);
        }
        const modelDistribution = Array.from(modelMap.entries())
          .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost, count: v.count }))
          .sort((a, b) => b.cost - a.cost);

        // Latency stats per task×model
        const latencyBuckets = new Map<string, number[]>();
        for (const log of logs) {
          const key = `${log.task}::${log.model}`;
          const arr = latencyBuckets.get(key) ?? [];
          arr.push(log.latencyMs);
          latencyBuckets.set(key, arr);
        }
        const latencyStats = Array.from(latencyBuckets.entries()).map(([key, values]) => {
          const [task, model] = key.split("::");
          values.sort((a, b) => a - b);
          const percentile = (p: number) => values[Math.min(Math.floor(values.length * p), values.length - 1)];
          return {
            task,
            model,
            count: values.length,
            avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
            p50: percentile(0.5),
            p90: percentile(0.9),
            p95: percentile(0.95),
            p99: percentile(0.99),
          };
        });

        return {
          summary: { totalTokens, totalRequests, avgLatency, totalCostUsd },
          dailyBurn,
          taskCosts,
          modelDistribution,
          latencyStats,
        };
      },
      {
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      },
    )

    .get("/budgets", async ({ session }) => {
      const budget = await prisma.userBudget.findUnique({
        where: { userId: session!.user.id },
      });
      if (!budget) {
        return { dailyBudgetUsd: null, monthlyBudgetUsd: null, alertEmail: null };
      }
      return {
        dailyBudgetUsd: budget.dailyBudgetUsd ? Number.parseFloat(budget.dailyBudgetUsd.toString()) : null,
        monthlyBudgetUsd: budget.monthlyBudgetUsd ? Number.parseFloat(budget.monthlyBudgetUsd.toString()) : null,
        alertEmail: budget.alertEmail,
      };
    })

    .put(
      "/budgets",
      async ({ body, session }) => {
        const userId = session!.user.id;
        const data = {
          dailyBudgetUsd: body.dailyBudgetUsd ?? null,
          monthlyBudgetUsd: body.monthlyBudgetUsd ?? null,
          alertEmail: body.alertEmail ?? null,
        };
        await prisma.userBudget.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        });
        return { ok: true };
      },
      {
        body: t.Object({
          dailyBudgetUsd: t.Optional(t.Nullable(t.Number())),
          monthlyBudgetUsd: t.Optional(t.Nullable(t.Number())),
          alertEmail: t.Optional(t.Nullable(t.String())),
        }),
      },
    )

    .get("/alert-status", async ({ session }) => {
      return getAlertStatusImpl(session!.user.id);
    })

    .post("/refresh-pricing", async () => {
      await fetchAndCachePricingImpl();
      return { ok: true };
    });
}

export const usageRoute = createUsageRoute();
