import { BASE_URL, AUTH_TOKEN } from "../config.js";

export function authHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
    };
}

export function url(path) {
    return `${BASE_URL}${path}`;
}
