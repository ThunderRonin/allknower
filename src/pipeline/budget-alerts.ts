import prisma from "../db/client.ts";

export interface AlertStatus {
  configured: boolean;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  dailyOverBudget: boolean;
  monthlyOverBudget: boolean;
}

export async function getAlertStatus(userId: string): Promise<AlertStatus> {
  const budget = await prisma.userBudget.findUnique({ where: { userId } });

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [dailyAgg, monthlyAgg] = await Promise.all([
    prisma.lLMCallLog.aggregate({
      where: { userId, createdAt: { gte: startOfDay } },
      _sum: { costUsd: true },
    }),
    prisma.lLMCallLog.aggregate({
      where: { userId, createdAt: { gte: startOfMonth } },
      _sum: { costUsd: true },
    }),
  ]);

  const dailySpendUsd = Number.parseFloat((dailyAgg._sum.costUsd ?? 0).toString());
  const monthlySpendUsd = Number.parseFloat((monthlyAgg._sum.costUsd ?? 0).toString());
  const dailyBudgetUsd = budget?.dailyBudgetUsd ? Number.parseFloat(budget.dailyBudgetUsd.toString()) : null;
  const monthlyBudgetUsd = budget?.monthlyBudgetUsd ? Number.parseFloat(budget.monthlyBudgetUsd.toString()) : null;

  return {
    configured: !!budget,
    dailySpendUsd,
    monthlySpendUsd,
    dailyBudgetUsd,
    monthlyBudgetUsd,
    dailyOverBudget: dailyBudgetUsd !== null && dailySpendUsd > dailyBudgetUsd,
    monthlyOverBudget: monthlyBudgetUsd !== null && monthlySpendUsd > monthlyBudgetUsd,
  };
}

export async function dispatchDailyDigests(): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = startOfDay.toISOString().slice(0, 10);

  const budgets = await prisma.userBudget.findMany({
    where: {
      alertEmail: { not: null },
      OR: [
        { dailyBudgetUsd: { not: null } },
        { monthlyBudgetUsd: { not: null } },
      ],
    },
  });

  let sent = 0;
  for (const budget of budgets) {
    if (budget.digestLastSentDate === today) continue;
    if (!budget.alertEmail) continue;

    const status = await getAlertStatus(budget.userId);
    if (!status.dailyOverBudget && !status.monthlyOverBudget) continue;

    try {
      const { sendEmail } = await import("../notifications/email.ts");
      const lines: string[] = ["AllKnower Budget Alert\n"];
      if (status.dailyOverBudget) {
        lines.push(`Daily: $${status.dailySpendUsd.toFixed(4)} / $${status.dailyBudgetUsd!.toFixed(4)}`);
      }
      if (status.monthlyOverBudget) {
        lines.push(`Monthly: $${status.monthlySpendUsd.toFixed(4)} / $${status.monthlyBudgetUsd!.toFixed(4)}`);
      }

      await sendEmail({
        to: budget.alertEmail,
        subject: "AllKnower Budget Alert",
        text: lines.join("\n"),
      });

      await prisma.userBudget.update({
        where: { userId: budget.userId },
        data: { digestLastSentDate: today },
      });
      sent++;
    } catch (e) {
      console.error(`[budget-alerts] Failed to send digest for user ${budget.userId}:`, e);
    }
  }

  console.log(`[budget-alerts] Sent ${sent} digests`);
  return sent;
}
