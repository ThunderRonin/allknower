import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus } from "../helpers/checks.js";
import { defaultThresholds } from "../config.js";

export const options = {
    scenarios: {
        concurrent_dumps: {
            executor: "constant-vus",
            vus: 10,
            duration: "60s",
        },
    },
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<5000"],
        http_req_failed: ["rate<0.10"],
    },
};

export default function () {
    const id = __VU * 1000 + __ITER;
    const payload = JSON.stringify({
        rawText: `Character ${id}: A warrior from the ${id % 3 === 0 ? "north" : "south"}.`,
        mode: "auto",
    });
    const res = http.post(url("/brain-dump"), payload, {
        headers: authHeaders(),
        timeout: "15s",
    });
    checkStatus(res, 200);
}
