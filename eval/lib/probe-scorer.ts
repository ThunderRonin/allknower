interface Probe {
    id: string;
    question: string;
    expectedKeywords: string[];
    difficulty: "easy" | "medium" | "hard";
}

interface ProbeResult {
    probeId: string;
    question: string;
    passed: boolean;
    matchedKeywords: string[];
    missedKeywords: string[];
    difficulty: string;
    score: number;
}

const DIFFICULTY_WEIGHTS: Record<string, number> = {
    easy: 1.0,
    medium: 1.5,
    hard: 2.0,
};

/**
 * Scores a probe by matching its expected keywords against a compacted state object.
 *
 * @param probe - The probe to evaluate; its `expectedKeywords` are checked against the state
 * @param compactedState - An object representing compacted state that will be stringified and searched (case-insensitive)
 * @returns A `ProbeResult` where `passed` is `true` if at least 50% of `expectedKeywords` were found; `score` is the keyword match ratio multiplied by the difficulty weight. The result also includes `matchedKeywords`, `missedKeywords`, `difficulty`, `probeId`, and `question`.
 */
export function scoreProbeAgainstState(
    probe: Probe,
    compactedState: Record<string, unknown>,
): ProbeResult {
    const stateText = JSON.stringify(compactedState).toLowerCase();

    const matched: string[] = [];
    const missed: string[] = [];

    for (const keyword of probe.expectedKeywords) {
        if (stateText.includes(keyword.toLowerCase())) {
            matched.push(keyword);
        } else {
            missed.push(keyword);
        }
    }

    const keywordScore = probe.expectedKeywords.length > 0
        ? matched.length / probe.expectedKeywords.length
        : 0;

    const passed = keywordScore >= 0.5;

    return {
        probeId: probe.id,
        question: probe.question,
        passed,
        matchedKeywords: matched,
        missedKeywords: missed,
        difficulty: probe.difficulty,
        score: keywordScore * DIFFICULTY_WEIGHTS[probe.difficulty],
    };
}

/**
 * Score a probe by checking its expected keywords against a reconstructed context string.
 *
 * The function performs case-insensitive substring matching of each keyword against `rebuiltContext`,
 * collects matched and missed keywords, computes `keywordScore` as `matched.length / expectedKeywords.length` (or `0` when there are no expected keywords),
 * marks the probe as passed when `keywordScore >= 0.5`, and scales the final score by the probe's difficulty weight.
 *
 * @param probe - The probe to evaluate; `probe.expectedKeywords` are the keywords checked against the context.
 * @param rebuiltContext - The reconstructed context text used for matching (case-insensitive).
 * @returns A `ProbeResult` containing `probeId`, `question`, `matchedKeywords`, `missedKeywords`, `passed` (`true` when `keywordScore >= 0.5`), `difficulty`, and `score` (the keyword fraction multiplied by the difficulty weight).
 */
export function scoreProbeAgainstContext(
    probe: Probe,
    rebuiltContext: string,
): ProbeResult {
    const contextLower = rebuiltContext.toLowerCase();

    const matched: string[] = [];
    const missed: string[] = [];

    for (const keyword of probe.expectedKeywords) {
        if (contextLower.includes(keyword.toLowerCase())) {
            matched.push(keyword);
        } else {
            missed.push(keyword);
        }
    }

    const keywordScore = probe.expectedKeywords.length > 0
        ? matched.length / probe.expectedKeywords.length
        : 0;

    const passed = keywordScore >= 0.5;

    return {
        probeId: probe.id,
        question: probe.question,
        passed,
        matchedKeywords: matched,
        missedKeywords: missed,
        difficulty: probe.difficulty,
        score: keywordScore * DIFFICULTY_WEIGHTS[probe.difficulty],
    };
}

export interface SessionScore {
    sessionId: string;
    totalProbes: number;
    passed: number;
    failed: number;
    accuracy: number;
    weightedScore: number;
    maxWeightedScore: number;
    weightedAccuracy: number;
    results: ProbeResult[];
}

/**
 * Aggregate individual probe results into a session-level score summary.
 *
 * Computes counts and metrics including total probes, passed/failed counts, raw accuracy (passed / totalProbes or `0` when none),
 * summed weighted score, maximum possible weighted score (sum of difficulty weights), weighted accuracy (weightedScore / maxWeightedScore or `0` when max is `0`),
 * and returns the original list of results.
 *
 * @param sessionId - Identifier for the session being aggregated
 * @param results - Array of per-probe `ProbeResult` objects to aggregate
 * @returns A `SessionScore` containing totals, accuracy metrics, weighted scores, and the original `results`
 */
export function aggregateScores(sessionId: string, results: ProbeResult[]): SessionScore {
    const passed = results.filter((r) => r.passed).length;
    const maxWeighted = results.reduce((s, r) => s + DIFFICULTY_WEIGHTS[r.difficulty], 0);
    const actualWeighted = results.reduce((s, r) => s + r.score, 0);

    return {
        sessionId,
        totalProbes: results.length,
        passed,
        failed: results.length - passed,
        accuracy: results.length > 0 ? passed / results.length : 0,
        weightedScore: actualWeighted,
        maxWeightedScore: maxWeighted,
        weightedAccuracy: maxWeighted > 0 ? actualWeighted / maxWeighted : 0,
        results,
    };
}
