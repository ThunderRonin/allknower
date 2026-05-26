/**
 * One-shot backfill: compute costUsd for LLMCallLog rows that have
 * inputTokens + outputTokens but null costUsd. Safe to re-run.
 *
 * Usage: bun scripts/backfill-llm-costs.ts
 */
import prisma from "../src/db/client.ts";
import { initPricingCacheFromDb } from "../src/pipeline/pricing-fetcher.ts";
import { computeCostUsd } from "../src/pipeline/pricing-cache.ts";

async function main() {
  await initPricingCacheFromDb();

  const rows = await prisma.lLMCallLog.findMany({
    where: {
      costUsd: null,
      inputTokens: { not: null },
      outputTokens: { not: null },
    },
    select: { id: true, model: true, inputTokens: true, outputTokens: true },
  });

  console.log(`Found ${rows.length} rows to backfill`);

  let updated = 0;
  for (const row of rows) {
    if (row.inputTokens == null || row.outputTokens == null) continue;
    const cost = computeCostUsd(row.model, row.inputTokens, row.outputTokens);
    if (cost > 0) {
      await prisma.lLMCallLog.update({
        where: { id: row.id },
        data: { costUsd: cost },
      });
      updated++;
    }
  }

  console.log(`Backfilled ${updated} / ${rows.length} rows`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
