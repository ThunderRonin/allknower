import http from "k6/http";
import { url, authHeaders } from "../helpers/auth.js";
import { checkStatus, checkJson, checkLatency } from "../helpers/checks.js";
import { defaultThresholds, lightStages } from "../config.js";

export const options = {
    stages: lightStages,
    thresholds: {
        ...defaultThresholds,
        http_req_duration: ["p(95)<3000"],
    },
};

const texts = [
    "Aldric is the king of Valorheim. He rules from the Iron Citadel.",
    "Elara is a sorceress who studies the ancient texts of the Mage Tower.",
    "The Dragon's Spine mountains separate the northern and southern realms.",
];

export default function () {
    const rawText = texts[Math.floor(Math.random() * texts.length)];
    const payload = JSON.stringify({ rawText, mode: "auto" });
    const res = http.post(url("/brain-dump"), payload, {
        headers: authHeaders(),
        timeout: "10s",
    });
    checkStatus(res, 200);
    checkJson(res);
    checkLatency(res, 5000, "brain-dump < 5s");
}
