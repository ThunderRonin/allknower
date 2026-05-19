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
