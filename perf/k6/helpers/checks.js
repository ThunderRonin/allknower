import { check } from "k6";

export function checkStatus(res, expected = 200, name = "") {
    const label = name || `status is ${expected}`;
    check(res, { [label]: (r) => r.status === expected });
}

export function checkJson(res, name = "response is JSON") {
    check(res, {
        [name]: (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        },
    });
}

export function checkLatency(res, maxMs, name = "") {
    const label = name || `latency < ${maxMs}ms`;
    check(res, { [label]: (r) => r.timings.duration < maxMs });
}
