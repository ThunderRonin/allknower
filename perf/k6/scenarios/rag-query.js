import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";

export const options = {
    stages: defaultStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<500", "p(99)<1000"],
    },
};

const queries = [
    "Aldric king Valorheim",
    "magic sword ancient",
    "northern kingdom winter",
    "dragon lair mountains",
    "royal court politics",
];

export default function () {
    const query = queries[Math.floor(Math.random() * queries.length)];
    const payload = JSON.stringify({ query, topK: 5 });
    const res = http.post(url("/rag/query"), payload, { headers: authHeaders() });
    checkStatus(res, 200);
    checkJson(res);
}
