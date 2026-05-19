import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<5000"],
    },
};

export default function () {
    const noteId = `note-${Math.floor(Math.random() * 10) + 1}`;
    const payload = JSON.stringify({ noteId });
    const res = http.post(url("/suggest/relationships"), payload, {
        headers: authHeaders(),
        timeout: "10s",
    });
    checkStatus(res, 200);
    checkJson(res);
    checkLatency(res, 5000, "suggest < 5s");
}
