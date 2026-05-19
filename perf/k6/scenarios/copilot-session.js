import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";
import { sleep } from "k6";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<3000"],
    },
};

const turns = [
    "Tell me more about Aldric's background.",
    "What about his family lineage?",
    "How does he relate to the northern kingdoms?",
];

export default function () {
    const noteId = `note-perf-${__VU}`;
    const messages = [];

    for (const turn of turns) {
        messages.push({ role: "user", content: turn });
        const payload = JSON.stringify({
            noteId,
            messages: [...messages],
            noteContext: {
                noteId,
                title: "Aldric",
                content: "<p>Aldric is the king.</p>",
                labels: [{ name: "loreType", value: "character" }],
                relations: [],
            },
            ragChunks: [],
        });

        const res = http.post(url("/copilot/article"), payload, {
            headers: authHeaders(),
            timeout: "10s",
        });
        checkStatus(res, 200);
        checkJson(res);

        if (res.status === 200) {
            const body = JSON.parse(res.body);
            messages.push({ role: "assistant", content: body.reply || "..." });
        }

        sleep(0.5);
    }
}
