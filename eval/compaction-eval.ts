// Run: bun run eval/compaction-eval.ts [--session=kingdom-founding] [--threshold=0.8]
import { playSession, forceCompaction } from "./lib/session-player.ts";
import { scoreProbeAgainstState, scoreProbeAgainstContext, aggregateScores } from "./lib/probe-scorer.ts";
import { generateReport, printReport } from "./lib/report.ts";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/db/client.ts";

const args = process.argv.slice(2);
const sessionFilter = args.find((a) => a.startsWith("--session="))?.split("=")[1];
const threshold = parseFloat(args.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? "0.8");

const GOLDEN_DIR = join(import.meta.dir, "../test/fixtures/golden-sessions");
const PROBE_DIR = join(import.meta.dir, "probes");
const RESULTS_DIR = join(import.meta.dir, "results");

mkdirSync(RESULTS_DIR, { recursive: true });

const sessionFiles = ["kingdom-founding", "character-web", "multi-compaction"];
const sessions = sessionFilter ? sessionFiles.filter((s) => s === sessionFilter) : sessionFiles;

console.log(`Running compaction accuracy eval for: ${sessions.join(", ")}`);
console.log(`Threshold: ${(threshold * 100).toFixed(0)}%\n`);

const allScores = [];
let report;

try {
for (const sessionName of sessions) {
    console.log(`\n--- Evaluating: ${sessionName} ---`);

    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, `${sessionName}.json`), "utf-8"));
    const probes = JSON.parse(readFileSync(join(PROBE_DIR, `${sessionName}.probes.json`), "utf-8"));

    console.log(`  Playing ${golden.turns.length} turns...`);
    let played = await playSession(golden);
    console.log(`  Pre-compaction tokens: ${played.preCompactionTokens}`);

    console.log("  Forcing compaction...");
    played = await forceCompaction(played);
    console.log(`  Compaction #${played.compactionCount} complete.`);

    console.log(`  Scoring ${probes.probes.length} probes...`);
    const stateResults = probes.probes.map((probe: any) =>
        scoreProbeAgainstState(probe, played.postCompactionState ?? {})
    );

    const contextResults = probes.probes.map((probe: any) =>
        scoreProbeAgainstContext(probe, played.rebuiltContext)
    );

    const stateScore = aggregateScores(`${sessionName}-state`, stateResults);
    const contextScore = aggregateScores(`${sessionName}-context`, contextResults);

    allScores.push(stateScore, contextScore);

    console.log(`  State accuracy: ${(stateScore.accuracy * 100).toFixed(1)}%`);
    console.log(`  Context accuracy: ${(contextScore.accuracy * 100).toFixed(1)}%`);

    // Multi-compaction: force a second compaction for degradation testing
    if (sessionName === "multi-compaction") {
        console.log("  Forcing second compaction (degradation test)...");
        await prisma.loreSession.update({
            where: { id: played.dbSessionId },
            data: { tokensAccumulated: 85000 },
        });
        played = await forceCompaction(played);
        console.log(`  Compaction #${played.compactionCount} complete.`);

        const degradedResults = probes.probes.map((probe: any) =>
            scoreProbeAgainstState(probe, played.postCompactionState ?? {})
        );
        const degradedScore = aggregateScores(`${sessionName}-degraded`, degradedResults);
        allScores.push(degradedScore);

        const drop = stateScore.accuracy - degradedScore.accuracy;
        console.log(`  Degraded accuracy: ${(degradedScore.accuracy * 100).toFixed(1)}%`);
        console.log(`  Degradation: ${(drop * 100).toFixed(1)}% drop`);
    }
}

report = generateReport(allScores, threshold);
const reportText = printReport(report);

console.log("\n" + reportText);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = join(RESULTS_DIR, `eval-${timestamp}.json`);
const textPath = join(RESULTS_DIR, `eval-${timestamp}.txt`);

writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(textPath, reportText);

console.log(`\nResults saved to:`);
console.log(`  ${jsonPath}`);
console.log(`  ${textPath}`);
} finally {
    await prisma.$disconnect();
}

process.exit(report?.passed ? 0 : 1);
