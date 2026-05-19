import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { check } from "k6";

export const options = {
    scenarios: {
        lock_contention: {
            executor: "constant-vus",
            vus: 5,
            duration: "30s",
        },
    },
    thresholds: {
        http_req_failed: ["rate<0.20"],
    },
};

const SHARED_NOTE = "note-lock-test";

export default function () {
    const messages = [];
    for (let i = 0; i < 20; i++) {
        messages.push({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Turn ${i}: ${"Lorem ipsum dolor sit amet. ".repeat(50)}`,
        });
    }

    const payload = JSON.stringify({
        noteId: SHARED_NOTE,
        messages,
        noteContext: {
            noteId: SHARED_NOTE,
            title: "Lock Test",
            content: "<p>Lock contention test.</p>",
            labels: [],
            relations: [],
        },
        ragChunks: [],
    });

    const res = http.post(url("/copilot/article"), payload, {
        headers: authHeaders(),
        timeout: "30s",
    });

    check(res, {
        "not 500": (r) => r.status !== 500,
        "lock contention handled gracefully": (r) => r.status === 200 || r.status === 409 || r.status === 423,
    });
}
