export const BASE_URL = __ENV.ALLKNOWER_URL || "http://localhost:3001";
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || "perf-test-token";

export const defaultThresholds = {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
    http_reqs: ["rate>10"],
};

export const defaultStages = [
    { duration: "10s", target: 5 },
    { duration: "30s", target: 5 },
    { duration: "10s", target: 20 },
    { duration: "30s", target: 20 },
    { duration: "10s", target: 0 },
];

export const lightStages = [
    { duration: "5s", target: 2 },
    { duration: "20s", target: 2 },
    { duration: "5s", target: 0 },
];

export const heavyStages = [
    { duration: "10s", target: 10 },
    { duration: "60s", target: 10 },
    { duration: "10s", target: 50 },
    { duration: "60s", target: 50 },
    { duration: "10s", target: 0 },
];
