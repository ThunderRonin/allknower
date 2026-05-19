import type { SessionScore } from "./probe-scorer.ts";

export interface EvalReport {
    timestamp: string;
    sessions: SessionScore[];
    overallAccuracy: number;
    overallWeightedAccuracy: number;
    passThreshold: number;
    passed: boolean;
}

export function generateReport(scores: SessionScore[], threshold = 0.8): EvalReport {
    const totalProbes = scores.reduce((s, sc) => s + sc.totalProbes, 0);
    const totalPassed = scores.reduce((s, sc) => s + sc.passed, 0);
    const totalWeighted = scores.reduce((s, sc) => s + sc.weightedScore, 0);
    const totalMaxWeighted = scores.reduce((s, sc) => s + sc.maxWeightedScore, 0);

    return {
        timestamp: new Date().toISOString(),
        sessions: scores,
        overallAccuracy: totalProbes > 0 ? totalPassed / totalProbes : 0,
        overallWeightedAccuracy: totalMaxWeighted > 0 ? totalWeighted / totalMaxWeighted : 0,
        passThreshold: threshold,
        passed: (totalProbes > 0 ? totalPassed / totalProbes : 0) >= threshold,
    };
}

export function printReport(report: EvalReport): string {
    const lines: string[] = [];

    lines.push("===================================================");
    lines.push("  COMPACTION ACCURACY EVALUATION REPORT");
    lines.push(`  ${report.timestamp}`);
    lines.push("===================================================");
    lines.push("");

    for (const session of report.sessions) {
        lines.push(`--- ${session.sessionId} ---`);
        lines.push(`  Probes: ${session.passed}/${session.totalProbes} passed (${(session.accuracy * 100).toFixed(1)}%)`);
        lines.push(`  Weighted: ${session.weightedScore.toFixed(1)}/${session.maxWeightedScore.toFixed(1)} (${(session.weightedAccuracy * 100).toFixed(1)}%)`);
        lines.push("");

        for (const r of session.results) {
            const icon = r.passed ? "PASS" : "FAIL";
            lines.push(`  ${icon} [${r.difficulty}] ${r.probeId}: ${r.question}`);
            if (r.missedKeywords.length > 0) {
                lines.push(`    Missing: ${r.missedKeywords.join(", ")}`);
            }
        }
        lines.push("");
    }

    lines.push("===================================================");
    lines.push(`  OVERALL: ${(report.overallAccuracy * 100).toFixed(1)}% accuracy (threshold: ${(report.passThreshold * 100).toFixed(0)}%)`);
    lines.push(`  WEIGHTED: ${(report.overallWeightedAccuracy * 100).toFixed(1)}%`);
    lines.push(`  VERDICT: ${report.passed ? "PASS" : "FAIL"}`);
    lines.push("===================================================");

    return lines.join("\n");
}
