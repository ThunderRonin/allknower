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

/**
 * Selects and returns an action function at random with probability proportional to each entry's weight.
 *
 * @returns {Function} The chosen action function from the `weights` array; if selection fails, returns `weights[0].fn` as a fallback.
 */
function pickAction() {
    let r = Math.random() * totalWeight;
    for (const w of weights) {
        r -= w.weight;
        if (r <= 0) return w.fn;
    }
    return weights[0].fn;
}

/**
 * Perform a health check against the service's /health endpoint.
 * @returns {import('k6/http').Response} The HTTP response object for the GET request.
 */
function healthCheck() {
    return http.get(url("/health"));
}

/**
 * Send a RAG query for the term "kingdom" requesting the top 5 results.
 *
 * @returns {import('k6/http').Response} The HTTP response from the RAG query request.
 */
function ragQuery() {
    return http.post(url("/rag/query"), JSON.stringify({ query: "kingdom", topK: 5 }), {
        headers: authHeaders(),
    });
}

/**
 * Request autocomplete suggestions for a randomly chosen short prefix.
 *
 * The prefix is selected uniformly from the set ["Ald", "Val", "Daw", "Ela", "Nor"] and sent as the `q` query parameter.
 * @returns {import('k6/http').Response} The HTTP response object from the GET request.
 */
function autocomplete() {
    const q = ["Ald", "Val", "Daw", "Ela", "Nor"][Math.floor(Math.random() * 5)];
    return http.get(url(`/suggest/autocomplete?q=${q}`));
}

/**
 * Submits a raw-text "brain dump" to the /brain-dump endpoint for automatic processing.
 *
 * The request is sent with authentication headers and a 10s timeout.
 * @returns {object} The HTTP response object returned by the request.
 */
function brainDump() {
    return http.post(url("/brain-dump"), JSON.stringify({
        rawText: "A wandering bard sings tales of ancient heroes.",
        mode: "auto",
    }), { headers: authHeaders(), timeout: "10s" });
}

/**
 * Requests article expansion for the current virtual user's note from the copilot endpoint.
 * @returns {import('k6/http').Response} The HTTP response returned by the POST request.
 */
function copilotTurn() {
    return http.post(url("/copilot/article"), JSON.stringify({
        noteId: `note-mixed-${__VU}`,
        messages: [{ role: "user", content: "Expand this lore entry." }],
        noteContext: { noteId: `note-mixed-${__VU}`, title: "T", content: "", labels: [], relations: [] },
        ragChunks: [],
    }), { headers: authHeaders(), timeout: "10s" });
}

/**
 * Fetches the retrieval-augmented generation (RAG) system status from the `/rag/status` endpoint.
 * @returns {import('k6/http').Response} The HTTP response containing the RAG status payload. 
 */
function ragStatus() {
    return http.get(url("/rag/status"));
}

export default function () {
    const action = pickAction();
    const res = action();
    checkStatus(res, 200);
    sleep(Math.random() * 0.5);
}
