import http from "k6/http";
import { url } from "../helpers/auth.js";
import { checkStatus, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, defaultStages } from "../config.js";

export const options = {
    stages: defaultStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<100", "p(99)<200"],
    },
};

export default function () {
    const res = http.get(url("/health"));
    checkStatus(res, 200);
    checkLatency(res, 200, "health < 200ms");
}
