import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";
import { sleep } from "k6";

export const options = {
    stages: defaultStages,
    thresholds: defaultThresholds,
};

const weights = [
    { fn: healthCheck, weight: 30 },
    { fn: ragQuery, weight: 25 },
    { fn: autocomplete, weight: 20 },
    { fn: brainDump, weight: 10 },
    { fn: copilotTurn, weight: 10 },
    { fn: ragStatus, weight: 5 },
];

const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

function pickAction() {
    let r = Math.random() * totalWeight;
    for (const w of weights) {
        r -= w.weight;
        if (r <= 0) return w.fn;
    }
    return weights[0].fn;
}

function healthCheck() {
    return http.get(url("/health"));
}

function ragQuery() {
    return http.post(url("/rag/query"), JSON.stringify({ query: "kingdom", topK: 5 }), {
        headers: authHeaders(),
    });
}

function autocomplete() {
    const q = ["Ald", "Val", "Daw", "Ela", "Nor"][Math.floor(Math.random() * 5)];
    return http.get(url(`/suggest/autocomplete?q=${q}`));
}

function brainDump() {
    return http.post(url("/brain-dump"), JSON.stringify({
        rawText: "A wandering bard sings tales of ancient heroes.",
        mode: "auto",
    }), { headers: authHeaders(), timeout: "10s" });
}

function copilotTurn() {
    return http.post(url("/copilot/article"), JSON.stringify({
        noteId: `note-mixed-${__VU}`,
        messages: [{ role: "user", content: "Expand this lore entry." }],
        noteContext: { noteId: `note-mixed-${__VU}`, title: "T", content: "", labels: [], relations: [] },
        ragChunks: [],
    }), { headers: authHeaders(), timeout: "10s" });
}

function ragStatus() {
    return http.get(url("/rag/status"));
}

export default function () {
    const action = pickAction();
    const res = action();
    checkStatus(res, 200);
    sleep(Math.random() * 0.5);
}
